import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import App from '../src/App.tsx'
import { formatLocalDate, type Expense } from '../src/expenses.ts'
import { EXPENSES_STORAGE_KEY } from '../src/storage.ts'

beforeEach(() => localStorage.clear())

describe('关键记账交互', () => {
  it('金额为空时明确显示错误', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: '记一笔' }))
    expect(screen.getByRole('alert')).toHaveTextContent('请输入大于 0 的有效金额')
  })

  it('删除后可以在五秒内撤销', () => {
    const stored: Expense = {
      id: 'expense-1',
      amount: 18,
      category: '餐饮',
      date: formatLocalDate(),
      note: '午饭',
      paymentMethod: '微信',
      source: 'manual',
      createdAt: new Date().toISOString(),
    }
    localStorage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify([stored]))

    render(<App />)
    fireEvent.click(screen.getByTitle('删除记录'))
    expect(screen.queryByTitle('删除记录')).not.toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('已删除“午饭”')

    fireEvent.click(screen.getByRole('button', { name: '撤销' }))
    expect(screen.getByTitle('删除记录')).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(EXPENSES_STORAGE_KEY) ?? '[]')).toHaveLength(1)
  })
})
