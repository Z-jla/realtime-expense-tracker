import {
  createExpense,
  createExpenseKeySet,
  draftKey,
  isDuplicateDraft,
  moneyFormatter,
  type Draft,
  type Expense,
} from '../expenses.ts'
import type { OcrDocument, ParsedOcrResult, ParsedTransaction } from './types.ts'

type TransactionWithAmount = ParsedTransaction & { amount: number }

export type OcrReviewDecision = Extract<OcrDecision, { kind: 'review' }>

export type OcrDecision =
  | { kind: 'batch'; transactions: ParsedTransaction[] }
  | { kind: 'empty' }
  | {
      kind: 'review'
      transaction: ParsedTransaction & { amount: null }
      draft: Draft
      reason: 'missing-amount'
    }
  | {
      kind: 'review'
      transaction: TransactionWithAmount
      draft: Draft
      reason: 'not-expense' | 'warning' | 'low-confidence' | 'duplicate'
    }
  | {
      kind: 'save'
      transaction: TransactionWithAmount
      draft: Draft
      amount: number
    }

export function draftFromTransaction(transaction: ParsedTransaction): Draft {
  return {
    amount: transaction.amount?.toFixed(2) ?? '',
    category: transaction.category,
    date: transaction.date,
    note: transaction.note,
    paymentMethod: transaction.paymentMethod,
  }
}

export function createOcrBatchExpenses(
  transactions: ParsedTransaction[],
  existingExpenses: Expense[],
) {
  const existingKeys = createExpenseKeySet(existingExpenses)
  const added: Expense[] = []

  for (const transaction of transactions) {
    if (transaction.amount === null) continue
    const draft = draftFromTransaction(transaction)
    const key = draftKey(draft)
    if (key === null || existingKeys.has(key)) continue

    // Two visually separate rows can be legitimate charges with the same merchant, minute, and
    // amount. Compare only with records that existed before this import, not earlier rows here.
    added.push(createExpense(draft, 'screenshot', transaction.sourceRow))
  }

  return added
}

export function decideOcrDocument(
  document: OcrDocument,
  parsed: ParsedOcrResult,
  expenses: Expense[],
): OcrDecision {
  if (parsed.isBillList && parsed.transactions.length > 1) {
    return { kind: 'batch', transactions: parsed.transactions }
  }

  const transaction = parsed.transactions[0]
  if (!transaction) return { kind: 'empty' }

  const draft = draftFromTransaction(transaction)
  if (transaction.amount === null) {
    return {
      kind: 'review',
      transaction: { ...transaction, amount: null },
      draft,
      reason: 'missing-amount',
    }
  }
  const transactionWithAmount: TransactionWithAmount = {
    ...transaction,
    amount: transaction.amount,
  }
  if (transaction.direction !== 'expense') {
    return { kind: 'review', transaction: transactionWithAmount, draft, reason: 'not-expense' }
  }
  if (transaction.warnings.length > 0) {
    return { kind: 'review', transaction: transactionWithAmount, draft, reason: 'warning' }
  }

  const autoSaveThreshold = document.engine === 'PP-OCRv6-tiny' ? 0.91 : 0.96
  if (transaction.confidence < autoSaveThreshold) {
    return { kind: 'review', transaction: transactionWithAmount, draft, reason: 'low-confidence' }
  }
  if (isDuplicateDraft(draft, expenses)) {
    return { kind: 'review', transaction: transactionWithAmount, draft, reason: 'duplicate' }
  }

  return {
    kind: 'save',
    transaction: transactionWithAmount,
    draft,
    amount: transaction.amount,
  }
}

/** The user-facing copy for every review outcome, kept pure so it can be asserted directly. */
export function ocrReviewMessage(decision: OcrReviewDecision): string {
  if (decision.reason === 'missing-amount') {
    return '没有稳定识别到金额，已填入其他字段，请手动补充后保存。'
  }

  const amount = moneyFormatter.format(decision.transaction.amount)
  if (decision.reason === 'duplicate') {
    return `识别到 ${amount}，但疑似已经入账，请确认是否重复。`
  }

  const warning = decision.transaction.warnings[0]
  return warning
    ? `识别到 ${amount}，但${warning}，请确认后保存。`
    : `识别到 ${amount}，请确认商户和金额后保存。`
}
