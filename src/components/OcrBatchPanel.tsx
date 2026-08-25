import { CheckCircle2, X } from 'lucide-react'
import { moneyFormatter } from '../expenses.ts'
import type { OcrBatchCandidate } from '../ocr/decision.ts'

export type BatchCandidate = OcrBatchCandidate

const directionLabels = {
  expense: '支出',
  income: '收入',
  refund: '退款',
  unknown: '方向不明',
} as const

type Props = {
  candidates: BatchCandidate[]
  onToggle: (index: number) => void
  onCancel: () => void
  onConfirm: () => void
}
export default function OcrBatchPanel({ candidates, onToggle, onCancel, onConfirm }: Props) {
  if (candidates.length === 0) return null
  const selectedCount = candidates.filter((candidate) => candidate.selected).length
  return (
    <section className="ocr-batch-panel" aria-label="批量识别结果">
      <div className="section-title">
        <div>
          <span className="section-kicker">账单列表</span>
          <h2>选择要导入的支出</h2>
        </div>
        <span>{selectedCount}/{candidates.length} 笔</span>
      </div>
      <ul className="ocr-batch-list">
        {candidates.map((candidate, index) => (
          <li key={`${candidate.sourceRow ?? candidate.note}-${index}`}>
            <label className={candidate.direction !== 'expense' ? 'is-blocked' : undefined}>
              <input
                type="checkbox"
                checked={candidate.selected}
                disabled={candidate.direction !== 'expense'}
                onChange={() => onToggle(index)}
              />
              <span className="ocr-batch-copy">
                <strong>{candidate.note || '未识别商户'}</strong>
                <small>
                  {candidate.date} · {candidate.category} · {directionLabels[candidate.direction]} · 置信度 {Math.round(candidate.confidence * 100)}%
                </small>
                {candidate.direction !== 'expense' ? (
                  <small className="ocr-batch-warning">非支出项目，不会批量入账</small>
                ) : candidate.overlapDuplicate ? (
                  <small className="ocr-batch-warning">与前一张截图重复，默认不入账</small>
                ) : candidate.warnings[0] ? (
                  <small className="ocr-batch-warning">{candidate.warnings[0]}，请确认后勾选</small>
                ) : null}
              </span>
              <strong className="ocr-batch-amount">
                {candidate.amount === null ? '待确认' : moneyFormatter.format(candidate.amount)}
              </strong>
            </label>
          </li>
        ))}
      </ul>
      <div className="capture-actions">
        <button className="secondary-action" type="button" onClick={onCancel}>
          <X size={19} />取消
        </button>
        <button className="primary-action" type="button" onClick={onConfirm} disabled={selectedCount === 0}>
          <CheckCircle2 size={19} />批量入账
        </button>
      </div>
    </section>
  )
}
