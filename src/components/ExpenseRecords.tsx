import { useEffect, useMemo, useState } from 'react'
import { Clock3, Pencil, Search, Trash2 } from 'lucide-react'
import { moneyFormatter, type Expense } from '../expenses.ts'

type Props = {
  expenses: Expense[]
  monthKey: string
  categories: string[]
  onEdit: (expense: Expense) => void
  onDelete: (expense: Expense) => void
}

const PAGE_SIZE = 30

export default function ExpenseRecords({ expenses, monthKey, categories, onEdit, onDelete }: Props) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('全部')
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const filteredExpenses = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    return expenses
      .filter((expense) => expense.date.startsWith(monthKey))
      .filter((expense) => category === '全部' || expense.category === category)
      .filter((expense) => {
        if (!normalizedQuery) return true
        return [
          expense.note,
          expense.category,
          expense.paymentMethod,
          expense.date,
          expense.amount.toFixed(2),
        ].some((value) => value.toLowerCase().includes(normalizedQuery))
      })
      .sort((first, second) => {
        const byDate = second.date.localeCompare(first.date)
        return byDate || second.createdAt.localeCompare(first.createdAt)
      })
  }, [category, expenses, monthKey, query])

  useEffect(() => setVisibleCount(PAGE_SIZE), [category, monthKey, query])
  const visibleExpenses = filteredExpenses.slice(0, visibleCount)

  return (
    <section className="records-section">
      <div className="section-title">
        <h2>账单记录</h2>
        <span>{filteredExpenses.length} 笔</span>
      </div>
      <div className="record-filters">
        <label className="search-field">
          <Search size={17} />
          <input
            type="search"
            placeholder="在本月记录中搜索"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <select aria-label="按分类筛选" value={category} onChange={(event) => setCategory(event.target.value)}>
          <option value="全部">全部分类</option>
          {categories.map((item) => (
            <option key={item} value={item}>
              {item}
            </option>
          ))}
        </select>
      </div>

      {visibleExpenses.length > 0 ? (
        <>
          <ul className="expense-list">
            {visibleExpenses.map((expense) => (
              <li className="expense-item" key={expense.id}>
                <div className="expense-main">
                  <span className="category-pill" data-category={expense.category}>
                    {expense.category}
                  </span>
                  <div>
                    <strong>{expense.note || '未填写备注'}</strong>
                    <p>
                      <Clock3 size={14} />
                      {expense.date} · {expense.paymentMethod}
                      {expense.source === 'screenshot' ? ' · 截图识别' : ''}
                    </p>
                  </div>
                </div>
                <div className="expense-side">
                  <strong>{moneyFormatter.format(expense.amount)}</strong>
                  <div className="expense-actions">
                    <button
                      className="ghost-button"
                      type="button"
                      title="编辑记录"
                      onClick={() => onEdit(expense)}
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      className="ghost-button danger-button"
                      type="button"
                      title="删除记录"
                      onClick={() => onDelete(expense)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          {visibleExpenses.length < filteredExpenses.length ? (
            <button
              className="secondary-action load-more"
              type="button"
              onClick={() => setVisibleCount((current) => current + PAGE_SIZE)}
            >
              再显示 {Math.min(PAGE_SIZE, filteredExpenses.length - visibleExpenses.length)} 笔
            </button>
          ) : null}
        </>
      ) : (
        <p className="empty-text record-empty">当前筛选条件下没有记录。</p>
      )}
    </section>
  )
}
