import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor, type PluginListenerHandle } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { createBackupDocument, parseBackupText, type ParsedBackup } from './backup.ts'
import type { AppSettings, Expense } from './expenses.ts'

const BACKUP_DIRECTORY = 'backups'
const SNAPSHOT_PATH = `${BACKUP_DIRECTORY}/latest.json`
const SNAPSHOT_TEMP_PATH = `${BACKUP_DIRECTORY}/latest.json.tmp`
const SNAPSHOT_PREVIOUS_PATH = `${BACKUP_DIRECTORY}/previous.json`
const DOCUMENTS_SNAPSHOT_PATH = '实时记账/自动备份.json'
const CHANGES_PER_SNAPSHOT = 5
const FILE_NOT_FOUND_ERROR_CODE = 'OS-PLUG-FILE-0008'

type Snapshot = {
  expenses: Expense[]
  settings: AppSettings
}

export type AutomaticBackupWriteResult = {
  sandboxWritten: true
  documentsMirrored: boolean
}

export type AutomaticBackupStatus =
  | { state: 'saved'; documentsMirrored: boolean }
  | { state: 'failed' }

function isFileNotFoundError(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === FILE_NOT_FOUND_ERROR_CODE
  )
}

/**
 * Mirrors the snapshot into the shared Documents folder. Directory.Data lives inside the app
 * sandbox, so uninstalling — which a changed signing certificate forces the user to do — takes
 * every automatic backup with it. Android Auto Backup covers that case only on devices where
 * Google backup is available, which rules out many ROMs this app runs on.
 *
 * Creating and overwriting an app-owned file here is permitted under scoped storage, so the write
 * is reliable. Reading it back after a reinstall is not: the reinstalled package may no longer be
 * recorded as the file's owner. The durable guarantee is therefore that the file survives on disk
 * where the user can re-import it through the file picker; readAutomaticBackup only tries the
 * automatic path opportunistically.
 *
 * Best-effort by design: losing the mirror must never turn a successful primary write into a
 * reported failure.
 */
async function mirrorToDocuments(payload: string) {
  if (!Capacitor.isNativePlatform()) return false
  const options = {
    path: DOCUMENTS_SNAPSHOT_PATH,
    data: payload,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  } as const
  try {
    await Filesystem.writeFile(options)
    const verification = await Filesystem.readFile({
      path: DOCUMENTS_SNAPSHOT_PATH,
      directory: Directory.Documents,
      encoding: Encoding.UTF8,
    })
    const verifiedText =
      typeof verification.data === 'string' ? verification.data : await verification.data.text()
    if (verifiedText !== payload) return false
    parseBackupText(verifiedText)
    return true
  } catch {
    return false
  }
}

/**
 * Writes to a temp file and renames it into place. A direct overwrite that is interrupted
 * (the OS killing the process right after `pause`) leaves a truncated file behind, which is
 * exactly the moment the snapshot has to be readable. The previous snapshot is kept as a
 * second line of defence.
 */
export async function writeAutomaticBackup(expenses: Expense[], settings: AppSettings) {
  if (!Capacitor.isNativePlatform()) return null

  const payload = JSON.stringify(createBackupDocument(expenses, settings))

  await Filesystem.writeFile({
    path: SNAPSHOT_TEMP_PATH,
    data: payload,
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
  return {
    sandboxWritten: true,
    documentsMirrored: await mirrorToDocuments(payload),
  } satisfies AutomaticBackupWriteResult
}

async function readSnapshotAt(
  path: string,
  directory: Directory = Directory.Data,
): Promise<ParsedBackup | null> {
  try {
    const result = await Filesystem.readFile({
      path,
      directory,
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
  return (
    (await readSnapshotAt(SNAPSHOT_PATH)) ??
    (await readSnapshotAt(SNAPSHOT_PREVIOUS_PATH)) ??
    // Reached after a reinstall wiped the sandbox. Scoped storage may refuse this read when the
    // reinstalled package is no longer the recorded owner, in which case the user still recovers
    // by importing the same file through the picker.
    (await readSnapshotAt(DOCUMENTS_SNAPSHOT_PATH, Directory.Documents))
  )
}

export function createAutomaticBackupController(
  getSnapshot: () => Snapshot,
  onStatus?: (status: AutomaticBackupStatus) => void,
) {
  let changes = 0
  let listener: PluginListenerHandle | null = null
  let listenerGeneration = 0
  let writeQueue = Promise.resolve()

  const flush = () => {
    const { expenses, settings } = getSnapshot()
    writeQueue = writeQueue
      .then(async () => {
        try {
          const result = await writeAutomaticBackup(expenses, settings)
          if (result) {
            onStatus?.({ state: 'saved', documentsMirrored: result.documentsMirrored })
          }
        } catch {
          onStatus?.({ state: 'failed' })
        }
      })
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
