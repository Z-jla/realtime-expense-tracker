import { describe, expect, it } from 'vitest'
import type { Expense } from '../src/expenses.ts'
import { decideOcrDocument, ocrReviewMessage } from '../src/ocr/decision.ts'
import type {
  OcrDocument,
  ParsedOcrResult,
  ParsedTransaction,
} from '../src/ocr/types.ts'

function transaction(overrides: Partial<ParsedTransaction> = {}): ParsedTransaction {
  return {
    amount: 25,
    category: '餐饮',
    date: '2026-08-22',
    note: '午饭',
    paymentMethod: '微信',
    direction: 'expense',
    confidence: 0.95,
    amountCandidate: null,
    alternatives: [],
    warnings: [],
    ...overrides,
  }
}

function document(engine: OcrDocument['engine'] = 'PP-OCRv6-tiny'): OcrDocument {
  return {
    engine,
    width: 1080,
    height: 2400,
    lines: [],
    text: '付款成功\n25.00\n午饭',
    metrics: {},
  }
}

function parsed(
  transactions: ParsedTransaction[],
  isBillList = false,
): ParsedOcrResult {
  return { transactions, isBillList, documentConfidence: 0.96 }
}

function expense(): Expense {
  return {
    id: 'existing',
    amount: 25,
    category: '餐饮',
    date: '2026-08-22',
    note: '午饭',
    paymentMethod: '微信',
    source: 'manual',
    createdAt: '2026-08-22T04:00:00.000Z',
  }
}

describe('OCR 入账决策', () => {
  it('自动保存高置信度 PP-OCR 支出', () => {
    const decision = decideOcrDocument(document(), parsed([transaction()]), [])
    expect(decision.kind).toBe('save')
  })

  it('让低置信度、缺金额和带警告结果进入复核', () => {
    expect(
      decideOcrDocument(document(), parsed([transaction({ confidence: 0.8 })]), []),
    ).toMatchObject({ kind: 'review', reason: 'low-confidence' })
    expect(
      decideOcrDocument(document(), parsed([transaction({ amount: null })]), []),
    ).toMatchObject({ kind: 'review', reason: 'missing-amount' })
    expect(
      decideOcrDocument(
        document(),
        parsed([transaction({ warnings: ['存在多个金额候选'] })]),
        [],
      ),
    ).toMatchObject({ kind: 'review', reason: 'warning' })
  })

  it('阻止疑似重复支出自动入账', () => {
    const decision = decideOcrDocument(document(), parsed([transaction()]), [expense()])
    expect(decision).toMatchObject({ kind: 'review', reason: 'duplicate' })
  })

  it('将多笔账单交给批量确认', () => {
    const transactions = [transaction(), transaction({ amount: 8, note: '地铁' })]
    const decision = decideOcrDocument(document(), parsed(transactions, true), [])
    expect(decision).toMatchObject({ kind: 'batch' })
    if (decision.kind === 'batch') expect(decision.transactions).toHaveLength(2)
  })

  it('Tesseract 使用更严格的自动入账阈值', () => {
    const decision = decideOcrDocument(
      document('Tesseract.js'),
      parsed([transaction({ confidence: 0.95 })]),
      [],
    )
    expect(decision).toMatchObject({ kind: 'review', reason: 'low-confidence' })
  })
})

describe('复核文案', () => {
  function reviewMessageFor(
    overrides: Partial<ParsedTransaction>,
    expenses: Expense[] = [],
  ): string {
    const decision = decideOcrDocument(
      document(),
      parsed([transaction(overrides)]),
      expenses,
    )
    if (decision.kind !== 'review') {
      throw new Error(`预期进入复核，实际是 ${decision.kind}`)
    }
    return ocrReviewMessage(decision)
  }

  it('缺金额时引导手动补充，且不显示金额', () => {
    const message = reviewMessageFor({ amount: null })
    expect(message).toBe('没有稳定识别到金额，已填入其他字段，请手动补充后保存。')
  })

  it('疑似重复时提示确认是否重复', () => {
    const message = reviewMessageFor({}, [expense()])
    expect(message).toContain('疑似已经入账')
    expect(message).toContain('25.00')
  })

  it('把第一条警告原文带进文案', () => {
    const message = reviewMessageFor({ warnings: ['存在多个接近的金额候选'] })
    expect(message).toContain('但存在多个接近的金额候选')
    expect(message).toContain('25.00')
  })

  it('仅置信度不足时提示确认商户和金额', () => {
    const message = reviewMessageFor({ confidence: 0.5 })
    expect(message).toContain('请确认商户和金额后保存')
  })

  it('收入方向也会给出可读文案', () => {
    const message = reviewMessageFor({ direction: 'income' })
    expect(message).toContain('25.00')
  })
})
