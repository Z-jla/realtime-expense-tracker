import assert from 'node:assert/strict'
import test from 'node:test'
import { formatOcrReview, parseOcrDocument } from '../src/ocr/parser.ts'

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

function document(lines, engine = 'PP-OCRv6-tiny', height = 1920) {
  return {
    engine,
    width: 1080,
    height,
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

test('账单列表兼容 PP-OCR 输出的全角与上下标收支符号', () => {
  const parsed = parseOcrDocument(
    document([
      line('全部账单', 420, 40, 240),
      line('北京艾斯酷科技有限公司 －１９．８０', 80, 180, 900),
      line('扫二维码付款-给随缘 ⁻15.00', 80, 270, 900),
      line('诚新烟酒经营部 ₋6.00', 80, 360, 900),
      line('工资 ＋100.00', 80, 450, 900),
    ]),
    NOW,
  )

  assert.equal(parsed.isBillList, true)
  assert.deepEqual(
    parsed.transactions.map((item) => item.amount),
    [19.8, 15, 6],
  )
  assert.deepEqual(
    parsed.transactions.map((item) => item.note),
    ['北京艾斯酷科技有限公司', '扫二维码付款-给随缘', '诚新烟酒经营部'],
  )
  assert.ok(parsed.transactions.every((item) => item.direction === 'expense'))
})

test('银行卡账单长截图忽略月度统计并提取八笔可见支出', () => {
  const screenshotNow = new Date(2026, 7, 24, 11, 7, 0)
  const parsed = parseOcrDocument(
    document([
      line('全部账单 查找交易 收支统计', 80, 40, 900),
      line('2026年8月 支出￥12210.53 收入￥100.00', 80, 110, 900),
      line('北京艾斯酷科技有限公司', 180, 240, 600),
      line('－１９．８０', 850, 240, 180),
      line('8月24日 10:07', 180, 290, 360),
      line('扫二维码付款-给随缘', 180, 400, 600),
      line('−15.00', 850, 400, 180),
      line('交易状态', 180, 436, 120, 8),
      line('8月22日 10:45', 180, 450, 360),
      line('诚新烟酒经营部', 180, 560, 600),
      line('－6.00', 850, 560, 180),
      line('四川农商银行', 40, 596, 120, 8),
      line('8月22日 10:28', 180, 610, 360),
      line('老桥理发店', 180, 720, 600),
      line('⁻15.00', 850, 720, 180),
      line('8月22日 10:01', 180, 770, 360),
      line('快宝', 180, 880, 600),
      line('₋1.00', 850, 880, 180),
      line('8月22日 08:52', 180, 930, 360),
      line('快宝', 180, 1040, 600),
      line('﹣1.00', 850, 1040, 180),
      line('8月22日 08:52', 180, 1090, 360),
      line('内江市东兴区城乡公共交通', 180, 1200, 600),
      line('–16.00', 850, 1200, 180),
      line('8月22日 07:47', 180, 1250, 360),
      line('迅驰出行', 180, 1360, 600),
      line('—0.99', 850, 1360, 180),
      line('8月21日 20:55', 180, 1410, 360),
    ]),
    screenshotNow,
  )

  assert.equal(parsed.isBillList, true)
  assert.deepEqual(
    parsed.transactions.map((item) => item.amount),
    [19.8, 15, 6, 15, 1, 1, 16, 0.99],
  )
  assert.equal(
    parsed.transactions.reduce((sum, item) => sum + (item.amount ?? 0), 0).toFixed(2),
    '74.79',
  )
  assert.deepEqual(
    parsed.transactions.map((item) => item.date),
    [
      '2026-08-24',
      '2026-08-22',
      '2026-08-22',
      '2026-08-22',
      '2026-08-22',
      '2026-08-22',
      '2026-08-22',
      '2026-08-21',
    ],
  )
})

test('账单中间日期漏识别时按纵向位置与下方明确日期回填', () => {
  const screenshotNow = new Date(2026, 7, 24, 11, 7, 0)
  const parsed = parseOcrDocument(
    document([
      line('全部账单', 420, 40, 240),
      line('第一笔 -19.80', 180, 240, 850),
      line('8月24日10:07', 180, 290, 360),
      line('第二笔 -15.00', 180, 400, 850),
      line('交易状态', 180, 450, 180),
      line('第三笔 -6.00', 180, 560, 850),
      line('银行图标文字', 40, 610, 180),
      line('银行卡尾号', 180, 650, 180),
      line('交易成功', 180, 690, 180),
      line('第四笔 -15.00', 180, 800, 850),
      line('8月22曰10:01', 180, 850, 360),
    ]),
    screenshotNow,
  )

  assert.deepEqual(
    parsed.transactions.map((item) => item.date),
    ['2026-08-24', '2026-08-22', '2026-08-22', '2026-08-22'],
  )
})

test('用户原始银行截图的 PP-OCR 实际输出保留每笔交易日期', () => {
  const screenshotNow = new Date(2026, 7, 24, 11, 7, 0)
  const parsed = parseOcrDocument(
    document(
      [
        line('全部账单、', 43, 320, 212, 51, 0.938),
        line('Q查找交易', 337, 321, 234, 52, 0.996),
        line('收支统计>', 852, 320, 190, 52, 0.961),
        line('2026年8月', 44, 489, 253, 52, 1),
        line('支出¥12210.53收入¥100.00', 551, 489, 489, 52, 0.988),
        line('北京艾斯酷科技有限公司', 218, 645, 499, 50, 0.999),
        line('-19.80', 904, 648, 132, 45, 1),
        line('背', 78, 710, 57, 45, 0.768),
        line('8月24日10:07', 218, 718, 306, 43, 0.999),
        line('扫二维码付款-给随缘', 218, 861, 491, 51, 0.994),
        line('-15.00', 904, 864, 132, 47, 1),
        line('8月22日10:45', 218, 934, 306, 43, 0.999),
        line('诚新烟酒经营部', 218, 1076, 344, 50, 0.999),
        line('-6.00', 926, 1082, 109, 43, 0.999),
        line('四川农商银行', 57, 1126, 133, 43, 1),
        line('8月22日10:28', 218, 1149, 306, 44, 1),
        line('老桥理发店', 218, 1293, 256, 50, 1),
        line('-15.00', 904, 1297, 132, 45, 1),
        line('8月22日10:01', 218, 1366, 306, 43, 1),
        line('快宝', 218, 1509, 102, 49, 1),
        line('-1.00', 925, 1512, 110, 45, 1),
        line('8月22日 08:52', 218, 1582, 324, 44, 0.966),
        line('快宝', 218, 1725, 102, 49, 1),
        line('-1.00', 925, 1728, 110, 46, 0.976),
        line('8月22日 08:52', 218, 1798, 324, 44, 0.97),
        line('内江市东兴区城乡公共交通...', 218, 1940, 613, 52, 0.97),
        line('-16.00', 904, 1945, 132, 45, 1),
        line('CCB', 72, 2004, 110, 41, 0.995),
        line('8月22日 07:47', 218, 2014, 324, 44, 0.962),
        line('迅驰出行', 218, 2157, 205, 50, 0.998),
        line('-0.99', 925, 2160, 110, 45, 0.999),
        line('8月21日20:55', 218, 2229, 306, 44, 1),
      ],
      'PP-OCRv6-tiny',
      2400,
    ),
    screenshotNow,
  )

  assert.deepEqual(
    parsed.transactions.map(({ amount, date }) => [amount, date]),
    [
      [19.8, '2026-08-24'],
      [15, '2026-08-22'],
      [6, '2026-08-22'],
      [15, '2026-08-22'],
      [1, '2026-08-22'],
      [1, '2026-08-22'],
      [16, '2026-08-22'],
      [0.99, '2026-08-21'],
    ],
  )
})

test('支付消息卡片列表识别全部无负号金额并绑定各自商户日期', () => {
  const screenshotNow = new Date(2026, 7, 24, 16, 8, 0)
  const parsed = parseOcrDocument(
    document(
      [
        line('服务消息', 301, 157, 191, 52, 1),
        line('支付消息', 582, 156, 195, 57, 1),
        line('淘宝', 166, 321, 93, 53, 1),
        line('8月22日晚上7:07', 170, 379, 240, 33, 0.999),
        line('付款成功', 456, 460, 164, 49, 1),
        line('¥33.00', 408, 515, 263, 81, 0.931),
        line('查看详情>', 468, 606, 164, 39, 0.991),
        line('付款方式 农业银行储蓄卡(3279)', 68, 692, 546, 41, 0.945),
        line('交易对象 李总**塔', 67, 760, 329, 44, 0.997),
        line('铁路12306', 171, 925, 198, 45, 1),
        line('中国铁路', 80, 987, 54, 23, 0.998),
        line('8月21日晚上7:15', 172, 980, 231, 31, 0.998),
        line('付款成功', 457, 1060, 164, 49, 1),
        line('¥71.00', 409, 1115, 258, 81, 0.916),
        line('查看详情>', 468, 1205, 165, 42, 0.989),
        line('付款方式 农业银行储蓄卡(3279)', 67, 1290, 547, 43, 0.974),
        line('零食有鸣（四川省成都市成...', 170, 1454, 523, 47, 0.937),
        line('8月21日下午12:20', 169, 1507, 252, 36, 0.999),
        line('付款成功', 456, 1590, 165, 49, 1),
        line('¥0.70', 432, 1644, 216, 83, 0.918),
        line('查看详情>', 467, 1735, 167, 42, 0.976),
        line('付款方式 农业银行储蓄卡(3279)', 68, 1822, 546, 41, 0.974),
        line('零食有鸣（四川省成都市成...', 170, 1984, 523, 47, 0.935),
        line('8月21日下午12:19', 171, 2041, 243, 30, 0.999),
        line('付款成功', 456, 2120, 165, 49, 1),
        line('￥6.70', 430, 2171, 218, 90, 0.907),
        line('查看详情>', 469, 2267, 163, 39, 0.935),
      ],
      'PP-OCRv6-tiny',
      2400,
    ),
    screenshotNow,
  )

  assert.equal(parsed.isBillList, true)
  assert.deepEqual(
    parsed.transactions.map(({ amount, date, note, direction, paymentMethod }) => ({
      amount,
      date,
      note,
      direction,
      paymentMethod,
    })),
    [
      {
        amount: 33,
        date: '2026-08-22',
        note: '淘宝',
        direction: 'expense',
        paymentMethod: '银行卡',
      },
      {
        amount: 71,
        date: '2026-08-21',
        note: '铁路12306',
        direction: 'expense',
        paymentMethod: '银行卡',
      },
      {
        amount: 0.7,
        date: '2026-08-21',
        note: '零食有鸣（四川省成都市成...',
        direction: 'expense',
        paymentMethod: '银行卡',
      },
      {
        amount: 6.7,
        date: '2026-08-21',
        note: '零食有鸣（四川省成都市成...',
        direction: 'expense',
        paymentMethod: '银行卡',
      },
    ],
  )
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

test('年初遇到未写年份的年末日期时归入上一年', () => {
  const parsed = parseOcrDocument(
    document([
      line('付款成功', 420, 100, 240),
      line('实付金额 ¥23.50', 280, 190, 520, 56),
      line('支付时间 12月31日 23:58', 120, 360, 800),
    ]),
    new Date(2027, 0, 2, 12, 0, 0),
  )

  assert.equal(parsed.transactions[0].date, '2026-12-31')
})

test('账单列表备注会先移除完整日期再移除金额', () => {
  const parsed = parseOcrDocument(
    document([
      line('全部账单', 420, 40, 240),
      line('8 月 18 日 肯德基 -23.50', 80, 180, 900),
      line('8 月 19 日 地铁乘车 -4.00', 80, 270, 900),
    ]),
    NOW,
  )

  assert.deepEqual(
    parsed.transactions.map((item) => item.note),
    ['肯德基', '地铁乘车'],
  )
})

test('识别复核文本按画面坐标从上到下、从左到右排列', () => {
  const source = document([
    line('底部', 100, 300, 200),
    line('右侧', 500, 100, 200),
    line('左侧', 100, 100, 200),
  ])
  const review = formatOcrReview(source, parseOcrDocument(source, NOW))

  assert.ok(review.indexOf('左侧 右侧') < review.indexOf('底部'))
})

test('超长付款卡片列表按上限截断，保留最靠前的三十笔', () => {
  const CARD_HEIGHT = 530
  const CARD_COUNT = 40
  const lines = [line('服务消息', 301, 157, 191, 52, 1)]
  for (let index = 0; index < CARD_COUNT; index += 1) {
    const top = 320 + index * CARD_HEIGHT
    lines.push(
      line(`商户${index + 1}`, 166, top, 200, 53, 1),
      line('8月21日下午12:20', 170, top + 58, 252, 36, 0.999),
      line('付款成功', 456, top + 140, 164, 49, 1),
      // Amounts stay distinct so truncation cannot be confused with deduplication.
      line(`¥${(index + 1).toFixed(2)}`, 408, top + 195, 263, 81, 0.93),
      line('查看详情>', 468, top + 286, 164, 39, 0.99),
      line('付款方式 农业银行储蓄卡(3279)', 68, top + 372, 546, 41, 0.945),
    )
  }
  const parsed = parseOcrDocument(
    document(lines, 'PP-OCRv6-tiny', 320 + CARD_COUNT * CARD_HEIGHT + 200),
    new Date(2026, 7, 24, 16, 8, 0),
  )

  assert.equal(parsed.isBillList, true)
  assert.equal(parsed.transactions.length, 30)
  assert.equal(parsed.transactions[0].amount, 1)
  assert.equal(parsed.transactions[29].amount, 30)
  assert.equal(parsed.truncatedTransactionCount, 10)
  assert.match(formatOcrReview(document(lines, 'PP-OCRv6-tiny', 320 + CARD_COUNT * CARD_HEIGHT + 200), parsed), /另有 10 笔超过单图上限/)
})
