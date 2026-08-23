import { CheckCircle2, Plus, X } from 'lucide-react'
import type { FormEventHandler } from 'react'
import {
  PAYMENT_METHODS,
  type Draft,
} from '../expenses.ts'

type Props = {
  draft: Draft
  categories: string[]
  editing: boolean
  reviewing: boolean
  maxDate: string
  error: { field: 'amount' | 'date'; message: string } | null
  onChange: (key: keyof Draft, value: string) => void
  onSubmit: FormEventHandler<HTMLFormElement>
  onCancel: () => void
}

export default function EntryForm({
  draft,
  categories,
  editing,
  reviewing,
  maxDate,
  error,
  onChange,
  onSubmit,
  onCancel,
}: Props) {
  const amountError = error?.field === 'amount'
  const dateError = error?.field === 'date'

  return (
    <form className="entry-form" onSubmit={onSubmit} noValidate>
      <div className="form-heading">
        <div>
          <span className="section-kicker">{reviewing ? '识别复核' : '快速录入'}</span>
          <h2>{editing ? '修改记录' : reviewing ? '确认识别结果' : '手动记一笔'}</h2>
        </div>
        {editing ? (
          <button className="ghost-button" type="button" title="取消编辑" onClick={onCancel}>
            <X size={17} />
          </button>
        ) : null}
      </div>

      <label className="field amount-field" htmlFor="amount">
        金额
        <input
          id="amount"
          inputMode="decimal"
          placeholder="0.00"
          value={draft.amount}
          aria-invalid={amountError}
          aria-describedby={amountError ? 'entry-form-error' : undefined}
          onChange={(event) => onChange('amount', event.target.value)}
        />
      </label>
      <div className="field-row">
        <label className="field">
          分类
          <select value={draft.category} onChange={(event) => onChange('category', event.target.value)}>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          日期
          <input
            type="date"
            max={maxDate}
            value={draft.date}
            aria-invalid={dateError}
            aria-describedby={dateError ? 'entry-form-error' : undefined}
            onChange={(event) => onChange('date', event.target.value)}
          />
        </label>
      </div>

      {error ? (
        <p id="entry-form-error" className="form-error" role="alert">
          {error.message}
        </p>
      ) : null}

      <div className="field-row">
        <label className="field">
          支付方式
          <select
            value={draft.paymentMethod}
            onChange={(event) => onChange('paymentMethod', event.target.value)}
          >
            {PAYMENT_METHODS.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          备注
          <input
            placeholder="例如 午饭、打车"
            value={draft.note}
            onChange={(event) => onChange('note', event.target.value)}
          />
        </label>
      </div>

      <button className="primary-action" type="submit">
        {editing ? <CheckCircle2 size={20} /> : <Plus size={20} />}
        {editing ? '保存修改' : reviewing ? '确认入账' : '记一笔'}
      </button>
    </form>
  )
}
