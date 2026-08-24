import {
  createExpense,
  draftKey,
  expenseKey,
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

export type OcrBatchReconciliation = {
  added: Expense[]
  updatedExpenses: Expense[]
  updated: number
}

function normalizedIdentityText(value: string | undefined) {
  return value?.replace(/\s+/g, ' ').trim().toLowerCase() ?? ''
}

function matchesOcrSource(expense: Expense, draft: Draft, sourceRow: string | undefined) {
  const normalizedSourceRow = normalizedIdentityText(sourceRow)
  return (
    normalizedSourceRow.length > 0 &&
    expense.source === 'screenshot' &&
    normalizedIdentityText(expense.rawText) === normalizedSourceRow &&
    expense.amount.toFixed(2) === draft.amount &&
    normalizedIdentityText(expense.note) === normalizedIdentityText(draft.note) &&
    expense.paymentMethod === draft.paymentMethod
  )
}

function hasExistingScreenshotOverlap(
  transactions: ParsedTransaction[],
  existingExpenses: Expense[],
) {
  const eligible = transactions.filter((transaction) => transaction.amount !== null)
  if (eligible.length < 3) return false

  const unmatchedIndexes = new Set(existingExpenses.map((_, index) => index))
  let matches = 0
  for (const transaction of eligible) {
    const draft = draftFromTransaction(transaction)
    const index = existingExpenses.findIndex(
      (expense, expenseIndex) =>
        unmatchedIndexes.has(expenseIndex) &&
        matchesOcrSource(expense, draft, transaction.sourceRow),
    )
    if (index < 0) continue
    unmatchedIndexes.delete(index)
    matches += 1
  }

  return matches >= Math.ceil(eligible.length * 0.6)
}

export function reconcileOcrBatchExpenses(
  transactions: ParsedTransaction[],
  existingExpenses: Expense[],
): OcrBatchReconciliation {
  const updatedExpenses = [...existingExpenses]
  const unmatchedIndexes = new Set(existingExpenses.map((_, index) => index))
  const added: Expense[] = []
  let updated = 0
  const canRepairDates = hasExistingScreenshotOverlap(transactions, existingExpenses)

  for (const transaction of transactions) {
    if (transaction.amount === null) continue
    const draft = draftFromTransaction(transaction)
    const key = draftKey(draft)
    if (key === null) continue

    const sameSourceAndDateIndex = updatedExpenses.findIndex(
      (expense, index) =>
        unmatchedIndexes.has(index) &&
        expense.date === draft.date &&
        matchesOcrSource(expense, draft, transaction.sourceRow),
    )
    if (sameSourceAndDateIndex >= 0) {
      unmatchedIndexes.delete(sameSourceAndDateIndex)
      continue
    }

    const repairableSourceIndex = canRepairDates
      ? updatedExpenses.findIndex(
          (expense, index) =>
            unmatchedIndexes.has(index) &&
            matchesOcrSource(expense, draft, transaction.sourceRow),
        )
      : -1
    if (repairableSourceIndex >= 0) {
      const sourceMatch = updatedExpenses[repairableSourceIndex]
      if (sourceMatch.date !== draft.date) {
        updatedExpenses[repairableSourceIndex] = { ...sourceMatch, date: draft.date }
        updated += 1
      }
      unmatchedIndexes.delete(repairableSourceIndex)
      continue
    }

    const exactMatchIndex = updatedExpenses.findIndex(
      (expense, index) => unmatchedIndexes.has(index) && expenseKey(expense) === key,
    )
    if (exactMatchIndex >= 0) {
      unmatchedIndexes.delete(exactMatchIndex)
      continue
    }

    // Matching each existing index only once preserves repeated real charges while still making a
    // second import idempotent.
    added.push(createExpense(draft, 'screenshot', transaction.sourceRow))
  }

  return { added, updatedExpenses, updated }
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
