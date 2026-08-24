import { memo, useMemo } from 'react'
import { moneyFormatter, type Expense } from '../expenses.ts'

type Props = {
  expenses: Expense[]
  monthKey: string
  categories: string[]
}

function CategoryStats({ expenses, monthKey, categories }: Props) {
  const { monthTotal, totals } = useMemo(() => {
    const totalsByCategory = new Map<string, number>()
    let selectedMonthTotal = 0
    for (const expense of expenses) {
      if (!expense.date.startsWith(monthKey)) continue
      selectedMonthTotal += expense.amount
      totalsByCategory.set(
        expense.category,
        (totalsByCategory.get(expense.category) ?? 0) + expense.amount,
      )
    }

    return {
      monthTotal: selectedMonthTotal,
      totals: categories
        .map((category) => ({ category, total: totalsByCategory.get(category) ?? 0 }))
        .filter((item) => item.total > 0)
        .sort((first, second) => second.total - first.total),
    }
  }, [categories, expenses, monthKey])
  const [year, month] = monthKey.split('-')

  return (
    <section className="stats-section">
      <div className="section-title">
        <div>
          <span className="section-kicker">支出结构</span>
          <h2>{year} 年 {Number(month)} 月分类</h2>
        </div>
        <span>{totals.length} 类</span>
      </div>
      {totals.length > 0 ? (
        <div className="category-list">
          {totals.map((item) => (
            <div className="category-row" key={item.category}>
              <div>
                <span className="category-name">
                  <span className="category-swatch" data-category={item.category} />
                  {item.category}
                </span>
                <span className="category-values">
                  <small>{Math.round((item.total / monthTotal) * 100)}%</small>
                  <strong>{moneyFormatter.format(item.total)}</strong>
                </span>
              </div>
              <div className="bar">
                <span style={{ width: `${Math.max(8, (item.total / monthTotal) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="empty-text">这个月还没有支出记录。</p>
      )}
    </section>
  )
}

export default memo(CategoryStats)
