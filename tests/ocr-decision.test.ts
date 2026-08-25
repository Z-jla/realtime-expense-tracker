import { describe, expect, it } from 'vitest'
import type { Expense } from '../src/expenses.ts'
import {
  decideOcrDocument,
  ocrReviewMessage,
  prepareOcrDocumentBatch,
  reconcileOcrBatchExpenses,
} from '../src/ocr/decision.ts'
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

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: 'existing',
    amount: 25,
    category: '餐饮',
    date: '2026-08-22',
    note: '午饭',
    paymentMethod: '微信',
    source: 'manual',
    createdAt: '2026-08-22T04:00:00.000Z',
    ...overrides,
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

  it('多图批量不会默认选择退款、收入、未知方向或带警告项目', () => {
    const candidates = prepareOcrDocumentBatch([
      {
        documentIndex: 0,
        documentText: '第一张',
        transactions: [
          transaction(),
          transaction({ direction: 'refund', note: '退款' }),
          transaction({ direction: 'income', note: '收入' }),
          transaction({ direction: 'unknown', note: '方向不明' }),
          transaction({ warnings: ['金额置信度偏低'], note: '需确认' }),
        ],
      },
    ])

    expect(candidates.map((candidate) => candidate.selected)).toEqual([
      true,
      false,
      false,
      false,
      false,
    ])
    const selected = candidates.filter(
      (candidate) => candidate.selected && candidate.direction === 'expense',
    )
    expect(reconcileOcrBatchExpenses(selected, []).added).toHaveLength(1)
    expect(
      reconcileOcrBatchExpenses(
        [transaction({ direction: 'refund', note: '退款' })],
        [],
      ).added,
    ).toHaveLength(0)
  })

  it('跨截图重叠行默认取消选择，同时保留同一截图内的真实重复扣款', () => {
    const duplicated = transaction({ amount: 1, note: '快宝', sourceRow: '快宝 -1.00' })
    const candidates = prepareOcrDocumentBatch([
      {
        documentIndex: 0,
        documentText: '第一张',
        transactions: [duplicated, duplicated],
      },
      {
        documentIndex: 1,
        documentText: '第二张',
        transactions: [duplicated, duplicated, duplicated],
      },
    ])

    expect(candidates.map(({ selected, overlapDuplicate }) => ({ selected, overlapDuplicate }))).toEqual([
      { selected: true, overlapDuplicate: false },
      { selected: true, overlapDuplicate: false },
      { selected: false, overlapDuplicate: true },
      { selected: false, overlapDuplicate: true },
      { selected: true, overlapDuplicate: false },
    ])
    expect(reconcileOcrBatchExpenses(candidates.filter((item) => item.selected), []).added).toHaveLength(3)
  })

  it('保留同一截图中的相同交易行，但阻止再次导入已有账单', () => {
    const duplicatedRows = [
      transaction({ amount: 1, note: '快宝', sourceRow: '快宝 -1.00' }),
      transaction({ amount: 1, note: '快宝', sourceRow: '快宝 -1.00' }),
    ]

    const firstImport = reconcileOcrBatchExpenses(duplicatedRows, []).added
    expect(firstImport).toHaveLength(2)
    expect(reconcileOcrBatchExpenses(duplicatedRows, firstImport.slice(0, 1)).added).toHaveLength(1)
    expect(reconcileOcrBatchExpenses(duplicatedRows, firstImport).added).toHaveLength(0)
  })

  it('再次导入同一截图时修正旧版保存错的日期', () => {
    const sourceRow = '扫二维码付款-给随缘 -15.00'
    const existing = expense({
      amount: 15,
      date: '2026-08-24',
      note: '扫二维码付款-给随缘',
      paymentMethod: '银行卡',
      source: 'screenshot',
      rawText: sourceRow,
    })
    const corrected = [
      transaction({
        amount: 15,
        date: '2026-08-22',
        note: '扫二维码付款-给随缘',
        paymentMethod: '银行卡',
        sourceRow,
      }),
      transaction({
        amount: 6,
        date: '2026-08-22',
        note: '诚新烟酒经营部',
        paymentMethod: '银行卡',
        sourceRow: '诚新烟酒经营部 -6.00',
      }),
      transaction({
        amount: 19.8,
        date: '2026-08-24',
        note: '北京艾斯酷科技有限公司',
        paymentMethod: '银行卡',
        sourceRow: '北京艾斯酷科技有限公司 -19.80',
      }),
    ]
    const matchingExisting = corrected.slice(1).map((item, index) =>
      expense({
        id: `matching-${index}`,
        amount: item.amount ?? 1,
        date: item.date,
        note: item.note,
        paymentMethod: item.paymentMethod,
        source: 'screenshot',
        rawText: item.sourceRow,
      }),
    )

    const result = reconcileOcrBatchExpenses(corrected, [existing, ...matchingExisting])
    expect(result.added).toHaveLength(0)
    expect(result.updated).toBe(1)
    expect(result.updatedExpenses[0]).toMatchObject({
      id: existing.id,
      date: '2026-08-22',
    })
  })

  it('不会用另一张截图的相似交易改写历史日期', () => {
    const sourceRow = '快宝 -1.00'
    const existing = expense({
      amount: 1,
      date: '2026-08-22',
      note: '快宝',
      paymentMethod: '银行卡',
      source: 'screenshot',
      rawText: sourceRow,
    })
    const laterTransaction = transaction({
      amount: 1,
      date: '2026-08-23',
      note: '快宝',
      paymentMethod: '银行卡',
      sourceRow,
    })

    const result = reconcileOcrBatchExpenses([laterTransaction], [existing])
    expect(result.added).toHaveLength(1)
    expect(result.updated).toBe(0)
    expect(result.updatedExpenses[0].date).toBe('2026-08-22')
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
