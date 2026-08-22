export type Expense = {
  id: string
  amount: number
  category: string
  date: string
  note: string
  paymentMethod: string
  source: 'manual' | 'screenshot'
  rawText?: string
  createdAt: string
}

export type Draft = {
  amount: string
  category: string
  date: string
  note: string
  paymentMethod: string
}

export type AppSettings = {
  monthlyBudget: number | null
  customCategories: string[]
}

export const DEFAULT_CATEGORIES = [
  '餐饮',
  '交通',
  '购物',
  '转账',
  '生活',
  '娱乐',
  '医疗',
  '住房',
  '其他',
] as const

export const PAYMENT_METHODS = ['微信', '支付宝', '银行卡', '现金', '其他'] as const

export const DEFAULT_SETTINGS: AppSettings = {
  monthlyBudget: null,
  customCategories: [],
}

export const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
})

export function createId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

export function formatLocalDate(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * `rawText` 只用于事后排查，界面从不展示它。完整 OCR 文本按账单条数累积会挤爆
 * localStorage 配额（WebView 通常只有 5–10 MB），所以只保留一小段摘要。
 */
export const RAW_TEXT_LIMIT = 200

export function truncateRawText(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  return trimmed.length <= RAW_TEXT_LIMIT ? trimmed : `${trimmed.slice(0, RAW_TEXT_LIMIT)}…`
}

export function defaultDraft(date = formatLocalDate()): Draft {
  return {
    amount: '',
    category: '餐饮',
    date,
    note: '',
    paymentMethod: '微信',
  }
}

function normalizeAmountCharacters(value: string) {
  const fullWidthDigits = '０１２３４５６７８９'
  return value
    .replace(/[０-９]/g, (character) => String(fullWidthDigits.indexOf(character)))
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[−–—]/g, '-')
    .replace(/[￥¥元\s']/gi, '')
    .trim()
}

/** Parses both Chinese/English decimal styles and common thousands separators. */
export function parseAmountInput(value: string): number | null {
  const compact = normalizeAmountCharacters(value)
  if (!compact || !/^[+-]?\d[\d.,]*$/.test(compact)) return null

  const sign = compact.startsWith('-') ? -1 : 1
  const unsigned = compact.replace(/^[+-]/, '')
  const lastComma = unsigned.lastIndexOf(',')
  const lastDot = unsigned.lastIndexOf('.')
  const lastSeparator = Math.max(lastComma, lastDot)
  let decimalIndex = -1

  if (lastSeparator >= 0) {
    const trailingDigits = unsigned.length - lastSeparator - 1
    const hasBothSeparators = lastComma >= 0 && lastDot >= 0
    const separator = unsigned[lastSeparator]
    const separatorCount = [...unsigned].filter((character) => character === separator).length
    if (hasBothSeparators || trailingDigits === 1 || trailingDigits === 2) {
      if (!hasBothSeparators && separatorCount > 1) return null
      decimalIndex = lastSeparator
    } else if (trailingDigits === 3) {
      const groups = unsigned.split(separator)
      const validThousands =
        !unsigned.includes(separator === ',' ? '.' : ',') &&
        /^\d{1,3}$/.test(groups[0]) &&
        groups.slice(1).every((group) => /^\d{3}$/.test(group))
      if (!validThousands) return null
    } else {
      return null
    }
  }

  const integerPart = unsigned
    .slice(0, decimalIndex >= 0 ? decimalIndex : undefined)
    .replace(/[.,]/g, '')
  const fractionPart =
    decimalIndex >= 0 ? unsigned.slice(decimalIndex + 1).replace(/[.,]/g, '') : ''

  if (!integerPart || !/^\d+$/.test(integerPart) || (fractionPart && !/^\d{1,2}$/.test(fractionPart))) {
    return null
  }

  const parsed = Number(`${sign < 0 ? '-' : ''}${integerPart}${fractionPart ? `.${fractionPart}` : ''}`)
  return Number.isFinite(parsed) ? parsed : null
}

export function sanitizeExpense(item: unknown): Expense | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>
  const amount = typeof raw.amount === 'number' ? raw.amount : Number(raw.amount)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 100_000_000) return null

  const rawDate = typeof raw.date === 'string' ? raw.date : ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : formatLocalDate()
  const expense: Expense = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    amount,
    category: typeof raw.category === 'string' && raw.category.trim() ? raw.category.trim() : '其他',
    date,
    note: typeof raw.note === 'string' ? raw.note.trim() : '',
    paymentMethod:
      typeof raw.paymentMethod === 'string' && raw.paymentMethod.trim()
        ? raw.paymentMethod.trim()
        : '其他',
    source: raw.source === 'screenshot' ? 'screenshot' : 'manual',
    createdAt:
      typeof raw.createdAt === 'string' && raw.createdAt
        ? raw.createdAt
        : new Date().toISOString(),
  }
  // 旧数据里可能存着整篇 OCR 文本，读取时就地截断，下一次保存即可回收空间。
  const rawText = truncateRawText(raw.rawText)
  if (rawText !== undefined) expense.rawText = rawText
  return expense
}

export function sanitizeSettings(value: unknown): AppSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_SETTINGS }
  const raw = value as Record<string, unknown>
  const budget = typeof raw.monthlyBudget === 'number' ? raw.monthlyBudget : null
  const customCategories = Array.isArray(raw.customCategories)
    ? raw.customCategories
        .filter((item): item is string => typeof item === 'string')
        .map((item) => item.trim().slice(0, 12))
        .filter(Boolean)
    : []

  return {
    monthlyBudget: budget !== null && Number.isFinite(budget) && budget > 0 ? budget : null,
    customCategories: [...new Set(customCategories)].slice(0, 30),
  }
}

export function createExpense(draft: Draft, source: Expense['source'], rawText?: string): Expense {
  const amount = parseAmountInput(draft.amount)
  if (amount === null || amount <= 0) throw new Error('金额必须大于 0')
  return {
    id: createId(),
    amount,
    category: draft.category,
    date: draft.date,
    note: draft.note.trim(),
    paymentMethod: draft.paymentMethod,
    source,
    rawText: truncateRawText(rawText),
    createdAt: new Date().toISOString(),
  }
}

function normalizedNote(note: string) {
  return note.replace(/\s+/g, '').replace(/截图识别|账单截图/g, '').toLowerCase()
}

function semanticExpenseKey(
  amount: number,
  date: string,
  paymentMethod: string,
  note: string,
) {
  return `${amount.toFixed(2)}|${date}|${paymentMethod}|${normalizedNote(note)}`
}

export function expenseKey(
  expense: Pick<Expense, 'amount' | 'date' | 'paymentMethod' | 'note'>,
) {
  return semanticExpenseKey(expense.amount, expense.date, expense.paymentMethod, expense.note)
}

/** Returns null when the draft has no parseable amount, i.e. it can never match an expense. */
export function draftKey(draft: Draft) {
  const amount = parseAmountInput(draft.amount)
  if (amount === null) return null
  return semanticExpenseKey(amount, draft.date, draft.paymentMethod, draft.note)
}

export function createExpenseKeySet(expenses: Expense[]) {
  return new Set(expenses.map(expenseKey))
}

export function isDuplicateDraft(draft: Draft, expenses: Expense[]) {
  const key = draftKey(draft)
  if (key === null) return false
  return expenses.some((expense) => expenseKey(expense) === key)
}

export function mergeImportedExpenses(rawItems: unknown[], existing: Expense[]) {
  const knownIds = new Set(existing.map((item) => item.id))
  const knownExpenses = createExpenseKeySet(existing)
  const added: Expense[] = []
  let invalid = 0
  let duplicates = 0

  for (const rawItem of rawItems) {
    const item = sanitizeExpense(rawItem)
    if (!item) {
      invalid += 1
      continue
    }
    const semanticKey = expenseKey(item)
    if (knownIds.has(item.id) || knownExpenses.has(semanticKey)) {
      duplicates += 1
      continue
    }
    knownIds.add(item.id)
    knownExpenses.add(semanticKey)
    added.push(item)
  }

  return { added, invalid, duplicates }
}

export function availableCategories(customCategories: string[], expenses: Expense[]) {
  return [
    ...new Set([
      ...DEFAULT_CATEGORIES,
      ...customCategories,
      ...expenses.map((expense) => expense.category),
    ]),
  ]
}
