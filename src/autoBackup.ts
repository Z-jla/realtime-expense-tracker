import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { createBackupDocument, parseBackupText, type ParsedBackup } from './backup.ts'
import type { AppSettings, Expense } from './expenses.ts'

const BACKUP_DIRECTORY = 'backups'
const SNAPSHOT_PATH = `${BACKUP_DIRECTORY}/latest.json`
const SNAPSHOT_TEMP_PATH = `${BACKUP_DIRECTORY}/latest.json.tmp`
const SNAPSHOT_PREVIOUS_PATH = `${BACKUP_DIRECTORY}/previous.json`
const CHANGES_PER_SNAPSHOT = 5
const FILE_NOT_FOUND_ERROR_CODE = 'OS-PLUG-FILE-0008'

type Snapshot = {
  expenses: Expense[]
  settings: AppSettings
}

function isFileNotFoundError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === FILE_NOT_FOUND_ERROR_CODE
  )
}

/**
 * Writes to a temp file and renames it into place. A direct overwrite that is interrupted
 * (the OS killing the process right after `pause`) leaves a truncated file behind, which is
 * exactly the moment the snapshot has to be readable. The previous snapshot is kept as a
 * second line of defence.
 */
export async function writeAutomaticBackup(expenses: Expense[], settings: AppSettings) {
  if (!Capacitor.isNativePlatform()) return false

  await Filesystem.writeFile({
    path: SNAPSHOT_TEMP_PATH,
    data: JSON.stringify(createBackupDocument(expenses, settings)),
    directory: Directory.Data,
    encoding: Encoding.UTF8,
    recursive: true,
  })

  try {
    await Filesystem.rename({
      from: SNAPSHOT_PATH,
      to: SNAPSHOT_PREVIOUS_PATH,
      directory: Directory.Data,
      toDirectory: Directory.Data,
    })
  } catch (error) {
    // There is no latest snapshot on the very first write. Other filesystem failures must
    // remain visible so callers do not mistake a failed rotation for a successful backup.
    if (!isFileNotFoundError(error)) throw error
  }

  await Filesystem.rename({
    from: SNAPSHOT_TEMP_PATH,
    to: SNAPSHOT_PATH,
    directory: Directory.Data,
    toDirectory: Directory.Data,
  })
  return true
}

async function readSnapshotAt(path: string): Promise<ParsedBackup | null> {
  try {
    const result = await Filesystem.readFile({
      path,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    })
    const text = typeof result.data === 'string' ? result.data : await result.data.text()
    return parseBackupText(text)
  } catch {
    return null
  }
}

export async function readAutomaticBackup(): Promise<ParsedBackup | null> {
  if (!Capacitor.isNativePlatform()) return null
  return (await readSnapshotAt(SNAPSHOT_PATH)) ?? (await readSnapshotAt(SNAPSHOT_PREVIOUS_PATH))
}

export function createAutomaticBackupController(getSnapshot: () => Snapshot) {
  let changes = 0
  let listener: PluginListenerHandle | null = null
  let listenerGeneration = 0
  let writeQueue = Promise.resolve()

  const flush = () => {
    const { expenses, settings } = getSnapshot()
    writeQueue = writeQueue
      .then(() => writeAutomaticBackup(expenses, settings))
      .then(() => undefined)
      .catch(() => undefined)
    return writeQueue
  }

  return {
    recordChange() {
      if (!Capacitor.isNativePlatform()) return
      changes += 1
      if (changes < CHANGES_PER_SNAPSHOT) return
      changes = 0
      void flush()
    },
    flush,
    async start() {
      if (!Capacitor.isNativePlatform()) return
      const generation = ++listenerGeneration
      const nextListener = await CapacitorApp.addListener('pause', () => {
        changes = 0
        void flush()
      })
      if (generation !== listenerGeneration) {
        await nextListener.remove()
        return
      }
      if (listener) await listener.remove()
      listener = nextListener
    },
    stop() {
      listenerGeneration += 1
      const current = listener
      listener = null
      if (current) void current.remove().catch(() => undefined)
    },
  }
}
