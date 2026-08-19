import assert from 'node:assert/strict'
import test from 'node:test'
import { parseOcrDocument } from '../src/ocr/parser.ts'

const NOW = new Date(2026, 7, 19, 12, 0, 0)

function line(text, x, y, width = 600, height = 32, confidence = 0.98) {
  return {
    text,
    confidence,
    polygon: [
      { x, y },
      { x: x + width, y },
      { x: x + width, y: y + height },
      { x, y: y + height },
    ],
  }
}

function document(lines, engine = 'PP-OCRv6-tiny') {
  return {
    engine,
    width: 1080,
    height: 1920,
    lines,
    text: lines.map((item) => item.text).join('\n'),
    metrics: { totalTimeMs: 420 },
  }
}

test('微信支付详情提取实付金额、商户与日期', () => {
  const parsed = parseOcrDocument(
    document([
      line('微信支付', 420, 50, 240),
      line('支付成功', 420, 120, 240),
      line('¥68.50', 365, 190, 350, 72),
      line('商户名称 肯德基人民路店', 100, 380, 800),
      line('支付时间 2026-08-18 12:30:05', 100, 450, 800),
      line('支付方式 零钱', 100, 520, 600),
    ]),
    NOW,
  )

  const transaction = parsed.transactions[0]
  assert.equal(parsed.isBillList, false)
  assert.equal(transaction.amount, 68.5)
  assert.equal(transaction.note, '肯德基人民路店')
  assert.equal(transaction.date, '2026-08-18')
  assert.equal(transaction.paymentMethod, '微信')
  assert.equal(transaction.direction, 'expense')
  assert.ok(transaction.confidence > 0.9)
})

test('支付宝详情识别元后缀金额', () => {
  const parsed = parseOcrDocument(
    document([
      line('支付宝', 440, 40, 200),
      line('付款成功', 420, 120, 240),
      line('12.00元', 390, 190, 300, 64),
      line('收款方 瑞幸咖啡', 120, 360, 700),
      line('交易时间 2026/08/19 09:20', 120, 430, 760),
    ]),
    NOW,
  )

  const transaction = parsed.transactions[0]
  assert.equal(transaction.amount, 12)
  assert.equal(transaction.note, '瑞幸咖啡')
  assert.equal(transaction.paymentMethod, '支付宝')
  assert.equal(transaction.direction, 'expense')
})

test('账单列表只提取支出并返回多笔候选', () => {
  const parsed = parseOcrDocument(
    document([
      line('全部账单', 420, 40, 240),
      line('肯德基 -23.50', 80, 180, 900),
      line('工资 +5000.00', 80, 270, 900),
      line('地铁乘车 -4.00', 80, 360, 900),
      line('退款到账 +12.00', 80, 450, 900),
    ]),
    NOW,
  )

  assert.equal(parsed.isBillList, true)
  assert.deepEqual(
    parsed.transactions.map((item) => item.amount),
    [23.5, 4],
  )
  assert.deepEqual(
    parsed.transactions.map((item) => item.note),
    ['肯德基', '地铁乘车'],
  )
  assert.ok(parsed.transactions.every((item) => item.direction === 'expense'))
})

test('余额不会覆盖邻近的实付金额', () => {
  const parsed = parseOcrDocument(
    document([
      line('支付成功', 400, 100, 280),
      line('实付金额 ¥32.80', 250, 190, 580, 56),
      line('账户余额 ¥500.00', 250, 280, 580),
      line('商户名称 星巴克', 120, 420, 760),
    ]),
    NOW,
  )

  assert.equal(parsed.transactions[0].amount, 32.8)
  assert.equal(parsed.transactions[0].alternatives[1]?.value, 500)
})

test('退款截图保留金额但标记为退款', () => {
  const parsed = parseOcrDocument(
    document([
      line('退款成功', 410, 100, 260),
      line('退款金额 ¥18.60', 300, 190, 480, 56),
      line('退款到账时间 2026-08-19 10:00', 120, 360, 800),
    ]),
    NOW,
  )

  assert.equal(parsed.transactions[0].amount, 18.6)
  assert.equal(parsed.transactions[0].direction, 'refund')
  assert.ok(parsed.transactions[0].warnings.some((warning) => warning.includes('退款')))
})

test('日期、时间和订单号不会被误判为金额', () => {
  const parsed = parseOcrDocument(
    document([
      line('交易时间 2026-08-19 12:30:05', 100, 180, 850),
      line('订单号 202608191230051234', 100, 260, 850),
    ]),
    NOW,
  )

  assert.equal(parsed.transactions[0].amount, null)
})

test('支持全角数字与中文金额标点', () => {
  const parsed = parseOcrDocument(
    document([
      line('付款成功', 420, 100, 240),
      line('实付金额 ￥１２。８０', 280, 190, 520, 56),
    ]),
    NOW,
  )

  assert.equal(parsed.transactions[0].amount, 12.8)
})
