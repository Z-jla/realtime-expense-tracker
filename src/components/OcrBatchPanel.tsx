import { CheckCircle2, X } from 'lucide-react'
import { moneyFormatter } from '../expenses.ts'
import type { ParsedTransaction } from '../ocr/types.ts'

export type BatchCandidate = ParsedTransaction & { selected: boolean }

type Props = {
  candidates: BatchCandidate[]
  onToggle: (index: number) => void
  onCancel: () => void
  onConfirm: () => void
}
export default function OcrBatchPanel({ candidates, onToggle, onCancel, onConfirm }: Props) {
  if (candidates.length === 0) return null
  return (
    <section className="ocr-batch-panel" aria-label="批量识别结果">
      <div className="section-title">
        <div>
          <span className="section-kicker">账单列表</span>
          <h2>选择要导入的支出</h2>
        </div>
        <span>{candidates.filter((candidate) => candidate.selected).length}/{candidates.length} 笔</span>
      </div>
      <ul className="ocr-batch-list">
        {candidates.map((candidate, index) => (
          <li key={`${candidate.sourceRow ?? candidate.note}-${index}`}>
            <label>
              <input type="checkbox" checked={candidate.selected} onChange={() => onToggle(index)} />
              <span className="ocr-batch-copy">
                <strong>{candidate.note || '未识别商户'}</strong>
                <small>
                  {candidate.date} · {candidate.category} · 置信度 {Math.round(candidate.confidence * 100)}%
                </small>
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
        <button className="primary-action" type="button" onClick={onConfirm}>
          <CheckCircle2 size={19} />批量入账
        </button>
      </div>
    </section>
  )
}
