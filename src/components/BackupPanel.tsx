import { useRef, useState, type ChangeEvent } from 'react'
import { Download, Upload } from 'lucide-react'
import { exportBackup, parseBackupText } from '../backup.ts'
import {
  mergeImportedExpenses,
  type AppSettings,
  type Expense,
} from '../expenses.ts'

type Props = {
  expenses: Expense[]
  settings: AppSettings
  today: string
  onExpensesChange: (expenses: Expense[]) => void
  onSettingsChange: (settings: AppSettings) => void
}

type Message = { tone: 'ok' | 'error'; text: string }

export default function BackupPanel({
  expenses,
  settings,
  today,
  onExpensesChange,
  onSettingsChange,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [message, setMessage] = useState<Message | null>(null)
  const [exporting, setExporting] = useState(false)
  const [importing, setImporting] = useState(false)

  const handleExport = async () => {
    if (expenses.length === 0 || exporting) return
    setExporting(true)
    try {
      const result = await exportBackup(expenses, settings, today)
      setMessage({
        tone: 'ok',
        text:
          result.location === 'documents'
            ? `备份已写入 Documents/实时记账/${result.fileName}${result.shared ? '，分享面板已打开' : ''}。`
            : `已开始下载 ${result.fileName}，请在下载列表确认文件。`,
      })
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? `导出失败：${error.message}` : '导出失败，请重试。',
      })
    } finally {
      setExporting(false)
    }
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    setImporting(true)
    setMessage(null)
    try {
      const backup = parseBackupText(await file.text())
      const result = mergeImportedExpenses(backup.expenses, expenses)
      if (result.added.length > 0) onExpensesChange([...result.added, ...expenses])
      if (backup.settings) {
        onSettingsChange({
          monthlyBudget: settings.monthlyBudget ?? backup.settings.monthlyBudget,
          customCategories: [
            ...new Set([...settings.customCategories, ...backup.settings.customCategories]),
          ],
        })
      }
      setMessage({
        tone: 'ok',
        text:
          result.added.length > 0
            ? `已导入 ${result.added.length} 笔记录${result.duplicates ? `，跳过 ${result.duplicates} 笔重复` : ''}${result.invalid ? `，忽略 ${result.invalid} 笔无效数据` : ''}。`
            : `没有新增记录${result.duplicates ? `，${result.duplicates} 笔均已存在` : ''}。`,
      })
    } catch (error) {
      setMessage({
        tone: 'error',
        text: error instanceof Error ? `导入失败：${error.message}` : '导入失败：文件无法解析。',
      })
    } finally {
      setImporting(false)
      event.target.value = ''
    }
  }

  return (
    <section className="backup-section">
      <div className="section-title">
        <div>
          <span className="section-kicker">数据安全</span>
          <h2>备份与恢复</h2>
        </div>
        <span>{expenses.length} 笔</span>
      </div>
      <input
        ref={inputRef}
        className="hidden-input"
        type="file"
        accept="application/json,.json"
        onChange={handleImport}
      />
      <div className="backup-actions">
        <button
          className="secondary-action"
          type="button"
          onClick={handleExport}
          disabled={expenses.length === 0 || exporting || importing}
        >
          <Download size={20} />
          {exporting ? '正在创建备份…' : '导出 JSON'}
        </button>
        <button
          className="secondary-action"
          type="button"
          disabled={exporting || importing}
          onClick={() => inputRef.current?.click()}
        >
          <Upload size={20} />
          {importing ? '正在导入…' : '导入 JSON'}
        </button>
      </div>
      {message ? (
        <p className={`backup-message ${message.tone === 'ok' ? 'is-ok' : 'is-error'}`} role="status">
          {message.text}
        </p>
      ) : null}
      <p className="backup-hint">
        Android 会先写入 Documents/实时记账，再打开系统分享面板；网页端请在下载列表确认。卸载前请确认备份文件已保存。
      </p>
    </section>
  )
}
