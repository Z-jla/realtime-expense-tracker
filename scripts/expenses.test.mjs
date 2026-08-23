import assert from 'node:assert/strict'
import test from 'node:test'
import { createBackupDocument, parseBackupText } from '../src/backup.ts'
import {
  MAX_EXPENSE_AMOUNT,
  RAW_TEXT_LIMIT,
  createExpense,
  createExpenseKeySet,
  draftKey,
  expenseKey,
  isValidExpenseDate,
  mergeImportedExpenses,
  parseAmountInput,
  sanitizeExpense,
  sanitizeSettings,
  truncateRawText,
} from '../src/expenses.ts'
import {
  EXPENSES_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  getStoredAppDataPresence,
  loadExpenses,
  loadSettings,
  saveExpenses,
  saveSettings,
} from '../src/storage.ts'

function expense(overrides = {}) {
  return {
    id: 'expense-1',
    amount: 12.5,
    category: '餐饮',
    date: '2026-08-22',
    note: '午饭',
    paymentMethod: '微信',
    source: 'manual',
    createdAt: '2026-08-22T04:00:00.000Z',
    ...overrides,
  }
}

function memoryStorage() {
  const values = new Map()
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
}

test('金额输入支持中英文小数与千分位', () => {
  assert.equal(parseAmountInput('1,234.56'), 1234.56)
  assert.equal(parseAmountInput('1.234,56'), 1234.56)
  assert.equal(parseAmountInput('1,234,567'), 1234567)
  assert.equal(parseAmountInput('￥１２，５０'), 12.5)
  assert.equal(parseAmountInput('1 234,50 元'), 1234.5)
})

test('金额输入拒绝空值、混乱分隔符与非数字', () => {
  assert.equal(parseAmountInput(''), null)
  assert.equal(parseAmountInput('1.2.3'), null)
  assert.equal(parseAmountInput('十二元'), null)
})

test('账单金额必须是分单位且不能超过统一上限', () => {
  assert.equal(sanitizeExpense(expense({ amount: 0.001 })), null)
  assert.deepEqual(sanitizeExpense(expense({ amount: 12.34 })), expense({ amount: 12.34 }))
})

test('费用清洗拒绝非法金额并保留有效记录', () => {
  assert.equal(sanitizeExpense({ amount: 0 }), null)
  assert.equal(sanitizeExpense({ amount: 'abc' }), null)
  assert.equal(sanitizeExpense(expense({ amount: MAX_EXPENSE_AMOUNT + 1 })), null)
  assert.deepEqual(sanitizeExpense(expense()), expense())
})

test('日期校验拒绝空值、错误格式和不存在的日期', () => {
  assert.equal(isValidExpenseDate('2024-02-29'), true)
  assert.equal(isValidExpenseDate('2026-02-29'), false)
  assert.equal(isValidExpenseDate('2026-13-01'), false)
  assert.equal(isValidExpenseDate('2026-8-22'), false)
  assert.equal(isValidExpenseDate(''), false)
  assert.equal(sanitizeExpense(expense({ date: '2026-02-29' })), null)
})

test('创建账单拒绝超限金额和无效日期', () => {
  const draft = {
    amount: '12.50',
    category: '餐饮',
    date: '2026-08-22',
    note: '午饭',
    paymentMethod: '微信',
  }
  assert.throws(() => createExpense({ ...draft, amount: String(MAX_EXPENSE_AMOUNT + 1) }, 'manual'))
  assert.throws(() => createExpense({ ...draft, date: '' }, 'manual'))
})

test('导入同时按 id 与业务字段去重', () => {
  const existing = [expense()]
  const result = mergeImportedExpenses(
    [
      expense(),
      expense({ id: 'expense-2' }),
      expense({ id: 'expense-3', amount: 20, note: '晚饭' }),
      { amount: -1 },
    ],
    existing,
  )
  assert.equal(result.added.length, 1)
  assert.equal(result.added[0].id, 'expense-3')
  assert.equal(result.duplicates, 2)
  assert.equal(result.invalid, 1)
})

test('账单和设置可以保存并重新加载', () => {
  const storage = memoryStorage()
  assert.equal(saveExpenses([expense()], storage), true)
  assert.deepEqual(loadExpenses(storage), [expense()])

  const settings = { monthlyBudget: 3000, customCategories: ['学习'] }
  assert.equal(saveSettings(settings, storage), true)
  assert.deepEqual(loadSettings(storage), settings)
})

test('存储存在性会分别识别缺失或损坏的账单与设置', () => {
  const storage = memoryStorage()
  storage.setItem(EXPENSES_STORAGE_KEY, 'not-json')
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ monthlyBudget: 3000 }))
  assert.deepEqual(getStoredAppDataPresence(storage), { expenses: false, settings: true })
})

test('存储存在性会检查数组内部账单和设置字段', () => {
  const storage = memoryStorage()
  storage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify([expense(), { amount: -1 }]))
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ monthlyBudget: '很多' }))
  assert.deepEqual(getStoredAppDataPresence(storage), { expenses: false, settings: false })

  storage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify([]))
  storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({}))
  assert.deepEqual(getStoredAppDataPresence(storage), { expenses: true, settings: true })
})

test('设置清洗会过滤无效预算和重复分类', () => {
  assert.deepEqual(
    sanitizeSettings({ monthlyBudget: -1, customCategories: ['学习', ' 学习 ', 1] }),
    { monthlyBudget: null, customCategories: ['学习'] },
  )
})

test('新版备份包含设置且继续兼容旧数组格式', () => {
  const settings = { monthlyBudget: 2000, customCategories: ['宠物'] }
  const document = createBackupDocument([expense()], settings)
  const parsed = parseBackupText(JSON.stringify(document))
  assert.deepEqual(parsed.expenses, [expense()])
  assert.deepEqual(parsed.settings, settings)

  const legacy = parseBackupText(JSON.stringify([expense()]))
  assert.deepEqual(legacy.expenses, [expense()])
  assert.equal(legacy.settings, null)
})

test('OCR 原文只保留摘要，避免撑爆本地存储', () => {
  const long = '实付金额'.repeat(400)
  assert.equal(truncateRawText(long).length, RAW_TEXT_LIMIT + 1)
  assert.equal(truncateRawText('  付款成功  '), '付款成功')
  assert.equal(truncateRawText('   '), undefined)
  assert.equal(truncateRawText(undefined), undefined)

  const created = createExpense(
    { amount: '12.50', category: '餐饮', date: '2026-08-22', note: '午饭', paymentMethod: '微信' },
    'screenshot',
    long,
  )
  assert.equal(created.rawText.length, RAW_TEXT_LIMIT + 1)
})

test('读取旧数据时就地截断超长 OCR 原文', () => {
  const bloated = sanitizeExpense(expense({ rawText: 'x'.repeat(5000) }))
  assert.equal(bloated.rawText.length, RAW_TEXT_LIMIT + 1)
  assert.equal(Object.hasOwn(sanitizeExpense(expense()), 'rawText'), false)
})

test('业务去重键对账单和草稿给出一致结果', () => {
  const stored = expense()
  const draft = { amount: '12.50', category: '其他', date: '2026-08-22', note: ' 午饭 ', paymentMethod: '微信' }
  assert.equal(draftKey(draft), expenseKey(stored))

  // 分类不参与去重：同一笔支出改了分类仍然会被认作重复。
  assert.equal(draftKey({ ...draft, category: '交通' }), expenseKey(stored))
  assert.notEqual(draftKey({ ...draft, amount: '12.51' }), expenseKey(stored))
  assert.equal(draftKey({ ...draft, amount: '' }), null)

  const keys = createExpenseKeySet([stored, expense({ id: 'expense-2', amount: 20, note: '晚饭' })])
  assert.equal(keys.size, 2)
  assert.equal(keys.has(draftKey(draft)), true)
})
