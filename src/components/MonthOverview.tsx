import { ChevronLeft, ChevronRight } from 'lucide-react'
import { memo, useMemo } from 'react'
import { moneyFormatter, type Expense } from '../expenses.ts'

type Props = {
  expenses: Expense[]
  monthKey: string
  currentMonth: string
  today: string
  monthlyBudget: number | null
  onMonthChange: (month: string) => void
}

function moveMonth(monthKey: string, offset: number) {
  const [year, month] = monthKey.split('-').map(Number)
  const date = new Date(year, month - 1 + offset, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(monthKey: string) {
  const [year, month] = monthKey.split('-')
  return `${year} 年 ${Number(month)} 月`
}

function MonthOverview({
  expenses,
  monthKey,
  currentMonth,
  today,
  monthlyBudget,
  onMonthChange,
}: Props) {
  const { averageDaily, monthExpenses, monthTotal, todayTotal, topCategory } = useMemo(() => {
    const selectedMonthExpenses: Expense[] = []
    const categoryTotals = new Map<string, number>()
    let selectedMonthTotal = 0
    let selectedTodayTotal = 0

    for (const expense of expenses) {
      if (expense.date === today) selectedTodayTotal += expense.amount
      if (!expense.date.startsWith(monthKey)) continue
      selectedMonthExpenses.push(expense)
      selectedMonthTotal += expense.amount
      categoryTotals.set(
        expense.category,
        (categoryTotals.get(expense.category) ?? 0) + expense.amount,
      )
    }

    const [year, month] = monthKey.split('-').map(Number)
    const elapsedDays =
      monthKey === currentMonth ? Number(today.slice(-2)) : new Date(year, month, 0).getDate()

    return {
      averageDaily: selectedMonthTotal / Math.max(1, elapsedDays),
      monthExpenses: selectedMonthExpenses,
      monthTotal: selectedMonthTotal,
      todayTotal: selectedTodayTotal,
      topCategory: [...categoryTotals].sort((first, second) => second[1] - first[1])[0],
    }
  }, [currentMonth, expenses, monthKey, today])
  const budgetRatio = monthlyBudget ? monthTotal / monthlyBudget : 0
  const remaining = monthlyBudget ? monthlyBudget - monthTotal : null

  return (
    <section className="overview-panel" aria-label="支出概览">
      <div className="month-switcher">
        <button
          className="ghost-button"
          type="button"
          aria-label="上一个月"
          onClick={() => onMonthChange(moveMonth(monthKey, -1))}
        >
          <ChevronLeft size={18} />
        </button>
        <label>
          <span>{monthLabel(monthKey)}</span>
          <input
            aria-label="选择月份"
            type="month"
            value={monthKey}
            max={currentMonth}
            onChange={(event) => event.target.value && onMonthChange(event.target.value)}
          />
        </label>
        <button
          className="ghost-button"
          type="button"
          aria-label="下一个月"
          disabled={monthKey >= currentMonth}
          onClick={() => onMonthChange(moveMonth(monthKey, 1))}
        >
          <ChevronRight size={18} />
        </button>
      </div>

      <div className="overview-main">
        <span>{monthLabel(monthKey)}支出</span>
        <strong>{moneyFormatter.format(monthTotal)}</strong>
        <p>
          {topCategory
            ? `最多花在${topCategory[0]}，共 ${moneyFormatter.format(topCategory[1])}`
            : '这个月还没有支出记录'}
        </p>
      </div>

      {monthlyBudget ? (
        <div className={`budget-status ${budgetRatio > 1 ? 'is-over' : ''}`}>
          <div>
            <span>月预算 {moneyFormatter.format(monthlyBudget)}</span>
            <strong>
              {remaining !== null && remaining >= 0
                ? `剩余 ${moneyFormatter.format(remaining)}`
                : `已超支 ${moneyFormatter.format(Math.abs(remaining ?? 0))}`}
            </strong>
          </div>
          <div className="bar" aria-label={`预算使用 ${Math.round(budgetRatio * 100)}%`}>
            <span style={{ width: `${Math.min(100, budgetRatio * 100)}%` }} />
          </div>
        </div>
      ) : null}

      <div className="overview-metrics">
        <div>
          <span>今日</span>
          <strong>{moneyFormatter.format(todayTotal)}</strong>
        </div>
        <div>
          <span>日均</span>
          <strong>{moneyFormatter.format(averageDaily)}</strong>
        </div>
        <div>
          <span>本月笔数</span>
          <strong>{monthExpenses.length}</strong>
        </div>
      </div>
    </section>
  )
}

export default memo(MonthOverview)
