import { Capacitor } from '@capacitor/core'
import { Directory, Encoding, Filesystem } from '@capacitor/filesystem'
import { Share } from '@capacitor/share'
import { sanitizeSettings, type AppSettings, type Expense } from './expenses.ts'

type BackupDocument = {
  app: 'spend-app'
  version: 2
  exportedAt: string
  expenses: Expense[]
  settings: AppSettings
}

export type ParsedBackup = {
  expenses: unknown[]
  settings: AppSettings | null
}

export function createBackupDocument(expenses: Expense[], settings: AppSettings): BackupDocument {
  return {
    app: 'spend-app',
    version: 2,
    exportedAt: new Date().toISOString(),
    expenses,
    settings,
  }
}

export function parseBackupText(text: string): ParsedBackup {
  const parsed = JSON.parse(text) as unknown
  if (Array.isArray(parsed)) return { expenses: parsed, settings: null }
  if (!parsed || typeof parsed !== 'object') throw new Error('备份文件格式不正确')
  const raw = parsed as Record<string, unknown>
  if (!Array.isArray(raw.expenses)) throw new Error('备份文件中没有账单列表')
  return {
    expenses: raw.expenses,
    settings: raw.settings === undefined ? null : sanitizeSettings(raw.settings),
  }
}

export type ExportResult = {
  fileName: string
  location: 'documents' | 'download'
  shared: boolean
}

async function writeNativeBackup(fileName: string, payload: string) {
  const options = {
    path: `实时记账/${fileName}`,
    data: payload,
    directory: Directory.Documents,
    encoding: Encoding.UTF8,
    recursive: true,
  } as const

  try {
    return await Filesystem.writeFile(options)
  } catch {
    const permission = await Filesystem.requestPermissions()
    if (permission.publicStorage !== 'granted') {
      throw new Error('没有“文档”目录写入权限，无法创建备份')
    }
    return Filesystem.writeFile(options)
  }
}

export async function exportBackup(
  expenses: Expense[],
  settings: AppSettings,
  date: string,
): Promise<ExportResult> {
  const fileName = `记账备份-${date}.json`
  const payload = JSON.stringify(createBackupDocument(expenses, settings), null, 2)

  if (Capacitor.isNativePlatform()) {
    const written = await writeNativeBackup(fileName, payload)
    const canShare = await Share.canShare()
    let shared = false
    if (canShare.value) {
      try {
        await Share.share({
          title: '实时记账备份',
          text: '请将备份文件保存到安全位置。',
          files: [written.uri],
          dialogTitle: '保存或分享记账备份',
        })
        shared = true
      } catch {
        // The backup already exists in Documents even when the chooser is cancelled.
      }
    }
    return { fileName, location: 'documents', shared }
  }

  const blob = new Blob([payload], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
  return { fileName, location: 'download', shared: false }
}
