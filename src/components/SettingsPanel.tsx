import { useEffect, useState } from 'react'
import { Plus, Settings2, X } from 'lucide-react'
import {
  DEFAULT_CATEGORIES,
  parseAmountInput,
  type AppSettings,
} from '../expenses.ts'

type Props = {
  settings: AppSettings
  onChange: (settings: AppSettings) => void
}
export default function SettingsPanel({ settings, onChange }: Props) {
  const [budget, setBudget] = useState(settings.monthlyBudget?.toFixed(2) ?? '')
  const [category, setCategory] = useState('')
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => setBudget(settings.monthlyBudget?.toFixed(2) ?? ''), [settings.monthlyBudget])

  const saveBudget = () => {
    if (!budget.trim()) {
      onChange({ ...settings, monthlyBudget: null })
      setMessage('已关闭月预算提醒。')
      return
    }
    const parsed = parseAmountInput(budget)
    if (parsed === null || parsed <= 0) {
      setMessage('请输入大于 0 的有效预算金额。')
      return
    }
    onChange({ ...settings, monthlyBudget: parsed })
    setBudget(parsed.toFixed(2))
    setMessage('月预算已保存。')
  }

  const addCategory = () => {
    const normalized = category.trim().slice(0, 12)
    if (!normalized) {
      setMessage('请输入分类名称。')
      return
    }
    if ([...DEFAULT_CATEGORIES, ...settings.customCategories].includes(normalized)) {
      setMessage('这个分类已经存在。')
      return
    }
    onChange({ ...settings, customCategories: [...settings.customCategories, normalized] })
    setCategory('')
    setMessage(`已添加分类“${normalized}”。`)
  }

  const removeCategory = (name: string) => {
    onChange({
      ...settings,
      customCategories: settings.customCategories.filter((item) => item !== name),
    })
    setMessage(`已移除自定义分类“${name}”，历史账单不会改变。`)
  }

  return (
    <details className="settings-section">
      <summary>
        <Settings2 size={18} />
        预算与自定义分类
      </summary>
      <div className="settings-content">
        <label className="field">
          每月预算
          <div className="inline-editor">
            <input
              inputMode="decimal"
              placeholder="留空表示不提醒"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
            />
            <button className="secondary-action" type="button" onClick={saveBudget}>
              保存
            </button>
          </div>
        </label>
        <label className="field">
          新分类
          <div className="inline-editor">
            <input
              maxLength={12}
              placeholder="例如 宠物、学习"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  addCategory()
                }
              }}
            />
            <button className="secondary-action" type="button" onClick={addCategory}>
              <Plus size={17} />
              添加
            </button>
          </div>
        </label>
        {settings.customCategories.length > 0 ? (
          <div className="category-chips" aria-label="自定义分类">
            {settings.customCategories.map((item) => (
              <span key={item}>
                {item}
                <button type="button" aria-label={`移除分类 ${item}`} onClick={() => removeCategory(item)}>
                  <X size={14} />
                </button>
              </span>
            ))}
          </div>
        ) : null}
        {message ? <p className="settings-message" role="status">{message}</p> : null}
      </div>
    </details>
  )
}
