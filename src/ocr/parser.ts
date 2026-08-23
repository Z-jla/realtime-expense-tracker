import type {
  AmountCandidate,
  OcrDocument,
  OcrLine,
  ParsedOcrResult,
  ParsedTransaction,
  TransactionDirection,
} from './types.ts'

type Bounds = {
  left: number
  top: number
  right: number
  bottom: number
}

type LogicalRow = {
  index: number
  text: string
  confidence: number
  bounds: Bounds
  lines: OcrLine[]
}

type CandidateWithGeometry = AmountCandidate & {
  signed: boolean
  row: LogicalRow
}

const STRONG_AMOUNT_ANCHOR = /(实付|实际支付|支付金额|付款金额|付款成功|支付成功|本次支付|本次付款)/
const MEDIUM_AMOUNT_ANCHOR = /(合计|总计|总金额|应付|交易金额|订单金额|消费金额|支出|转账金额)/
const NEGATIVE_AMOUNT_CONTEXT = /(优惠|折扣|减免|原价|余额|剩余|积分|红包|找零|手续费|收入|退款|退回)/
const BILL_LIST_UI = /(账单|全部账单|交易记录|月账单|收支统计|查找交易)/
const MONEY_PATTERN = /(?:[¥￥]\s*)?([+-]?\s*(?:\d{1,3}(?:,\d{3})+|\d{1,6})(?:[.,]\d{1,2})?)(?:\s*(?:元|rmb|cny))?/gi

const categoryRules: Array<[string, RegExp]> = [
  ['餐饮', /(餐|饭|外卖|美团|饿了么|咖啡|奶茶|食品|麦当劳|肯德基|瑞幸|星巴克|餐厅|小吃)/i],
  ['交通', /(地铁|公交|滴滴|打车|高德|铁路|火车|机票|停车|加油|高速|出租车)/i],
  ['购物', /(淘宝|天猫|京东|拼多多|抖音商城|购物|超市|便利店|盒马|山姆|商城)/i],
  ['转账', /(转账|转给|收款|付款码)/i],
  ['娱乐', /(电影|游戏|会员|ktv|演出|音乐|视频|剧院)/i],
  ['医疗', /(医院|药房|药店|医疗|挂号|诊所|体检)/i],
  ['住房', /(房租|物业|水费|电费|燃气|宽带)/i],
  ['生活', /(话费|快递|洗衣|维修|家政|日用)/i],
]

function clamp(value: number, minimum = 0, maximum = 1) {
  return Math.min(maximum, Math.max(minimum, value))
}

function localDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function normalizeOcrText(text: string) {
  const fullWidthDigits = '０１２３４５６７８９'
  return text
    .replace(/[０-９]/g, (character) => String(fullWidthDigits.indexOf(character)))
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[￥]/g, '¥')
    .replace(/[−–—]/g, '-')
    .replace(/(^|\s)一\s*(?=\d)/g, '$1-')
}

function repairNumericCharacters(text: string) {
  return normalizeOcrText(text)
    .replace(/(?<=\d)[oOQ](?=\d|[.,])/g, '0')
    .replace(/(?<=[¥￥+\-\s])[oOQ](?=\d)/g, '0')
    .replace(/(?<=\d)[Il|](?=\d|[.,])/g, '1')
    .replace(/(?<=[¥￥+\-\s])[Il|](?=\d)/g, '1')
}

function lineBounds(line: OcrLine): Bounds {
  const xValues = line.polygon.map((point) => point.x)
  const yValues = line.polygon.map((point) => point.y)
  return {
    left: Math.min(...xValues),
    top: Math.min(...yValues),
    right: Math.max(...xValues),
    bottom: Math.max(...yValues),
  }
}

function mergeBounds(first: Bounds, second: Bounds): Bounds {
  return {
    left: Math.min(first.left, second.left),
    top: Math.min(first.top, second.top),
    right: Math.max(first.right, second.right),
    bottom: Math.max(first.bottom, second.bottom),
  }
}

function centerY(bounds: Bounds) {
  return (bounds.top + bounds.bottom) / 2
}

function heightOf(bounds: Bounds) {
  return Math.max(1, bounds.bottom - bounds.top)
}

function verticalOverlap(first: Bounds, second: Bounds) {
  return Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top))
}

function buildRows(document: OcrDocument): LogicalRow[] {
  const sorted = [...document.lines]
    .filter((line) => line.text.trim())
    .sort((first, second) => {
      const firstBounds = lineBounds(first)
      const secondBounds = lineBounds(second)
      return firstBounds.top - secondBounds.top || firstBounds.left - secondBounds.left
    })
  const groups: Array<{ bounds: Bounds; lines: OcrLine[] }> = []

  for (const line of sorted) {
    const bounds = lineBounds(line)
    let bestGroup: (typeof groups)[number] | null = null
    let bestDistance = Number.POSITIVE_INFINITY

    for (const group of groups) {
      const overlap = verticalOverlap(bounds, group.bounds)
      const minimumHeight = Math.min(heightOf(bounds), heightOf(group.bounds))
      const distance = Math.abs(centerY(bounds) - centerY(group.bounds))
      const sameVisualRow = overlap / minimumHeight >= 0.42 || distance <= minimumHeight * 0.55
      if (sameVisualRow && distance < bestDistance) {
        bestGroup = group
        bestDistance = distance
      }
    }

    if (bestGroup) {
      bestGroup.lines.push(line)
      bestGroup.bounds = mergeBounds(bestGroup.bounds, bounds)
    } else {
      groups.push({ bounds, lines: [line] })
    }
  }

  return groups
    .sort((first, second) => first.bounds.top - second.bounds.top)
    .map((group, index) => {
      const lines = group.lines.sort(
        (first, second) => lineBounds(first).left - lineBounds(second).left,
      )
      return {
        index,
        text: lines.map((line) => normalizeOcrText(line.text)).join(' ').replace(/\s+/g, ' ').trim(),
        confidence:
          lines.reduce((sum, line) => sum + clamp(line.confidence), 0) / Math.max(lines.length, 1),
        bounds: group.bounds,
        lines,
      }
    })
}

function median(values: number[]) {
  if (values.length === 0) return 1
  const sorted = [...values].sort((first, second) => first - second)
  return sorted[Math.floor(sorted.length / 2)]
}

function parseMoney(rawValue: string) {
  let value = rawValue
    .replace(/[¥￥元\s]/gi, '')
    .replace(/rmb|cny/gi, '')
    .replace(/[+-]/g, '')

  if (value.includes('.') && value.includes(',')) {
    value = value.replace(/,/g, '')
  } else if (value.includes(',')) {
    value = /,\d{3}(?:,|$)/.test(value) ? value.replace(/,/g, '') : value.replace(',', '.')
  }
  const amount = Number(value)
  return Number.isFinite(amount) ? amount : null
}

function nearbyText(rows: LogicalRow[], row: LogicalRow, medianHeight: number, documentHeight: number) {
  return rows
    .filter((candidate) => {
      if (candidate.index === row.index) return true
      const gap = Math.abs(centerY(candidate.bounds) - centerY(row.bounds))
      return gap <= Math.max(medianHeight * 3.2, documentHeight * 0.055)
    })
    .map((candidate) => candidate.text)
    .join(' ')
}

function extractAmountCandidates(document: OcrDocument, rows: LogicalRow[]) {
  const rowHeights = rows.map((row) => heightOf(row.bounds))
  const medianHeight = median(rowHeights)
  const candidates: CandidateWithGeometry[] = []

  for (const row of rows) {
    const repaired = repairNumericCharacters(row.text)
    const context = nearbyText(rows, row, medianHeight, document.height)
    const hasStrongAnchor = STRONG_AMOUNT_ANCHOR.test(context)
    const hasMediumAnchor = MEDIUM_AMOUNT_ANCHOR.test(context)
    const hasNegativeContext = NEGATIVE_AMOUNT_CONTEXT.test(row.text)
    const dateAndTimeRanges = [
      ...repaired.matchAll(/(?:19|20)\d{2}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?/g),
      ...repaired.matchAll(/\d{1,2}[:：]\d{2}(?::\d{2})?/g),
    ].map((item) => ({ start: item.index, end: item.index + item[0].length }))
    const pattern = new RegExp(MONEY_PATTERN.source, MONEY_PATTERN.flags)
    let match: RegExpExecArray | null

    while ((match = pattern.exec(repaired)) !== null) {
      const matchedText = match[0].trim()
      const captured = match[1]
      const start = match.index
      const end = start + match[0].length
      const before = repaired[start - 1] ?? ''
      const after = repaired[end] ?? ''
      if (/\d/.test(before) || /\d/.test(after)) continue

      const insideDateOrTime = dateAndTimeRanges.some(
        (range) => start < range.end && end > range.start,
      )
      if (insideDateOrTime && !/[¥￥元]|rmb|cny/i.test(matchedText)) continue

      const amount = parseMoney(captured)
      if (amount === null || amount <= 0 || amount > 100000) continue

      const hasDecimal = /[.,]\d{1,2}(?:\D|$)/.test(matchedText)
      const hasCurrency = /[¥￥元]|rmb|cny/i.test(matchedText)
      const signed = /^[+-]/.test(captured.replace(/\s/g, ''))
      const lineOnlyAmount = /^[¥￥]?\s*[+-]?\s*\d{1,6}(?:[.,]\d{1,2})?\s*元?$/.test(
        repaired,
      )
      const looksLikeTime = /\d{1,2}[:：]\d{1,2}/.test(repaired) && !hasCurrency && !hasDecimal
      const looksLikeDate = /(19|20)\d{2}\s*[-/.年]\s*\d{1,2}/.test(repaired)
      const looksLikeYear = /^(19|20)\d{2}$/.test(String(Math.trunc(amount)))

      if (looksLikeTime && !hasStrongAnchor && !hasMediumAnchor && !signed) continue
      if (looksLikeDate && !hasCurrency && !hasDecimal && !signed) continue
      if (looksLikeYear && !hasCurrency && !hasStrongAnchor && !hasMediumAnchor) continue
      if (!hasDecimal && !hasCurrency && !signed && !lineOnlyAmount && !hasStrongAnchor && !hasMediumAnchor) {
        continue
      }

      let confidence = 0.12 + row.confidence * 0.34
      const reasons: string[] = [`OCR ${Math.round(row.confidence * 100)}%`]
      if (hasDecimal) {
        confidence += 0.11
        reasons.push('标准金额格式')
      }
      if (hasCurrency) {
        confidence += 0.14
        reasons.push('带币种')
      }
      if (lineOnlyAmount) {
        confidence += 0.11
        reasons.push('独立金额行')
      }
      if (STRONG_AMOUNT_ANCHOR.test(context)) {
        confidence += 0.3
        reasons.push('邻近实付/支付锚点')
      } else if (MEDIUM_AMOUNT_ANCHOR.test(context)) {
        confidence += 0.2
        reasons.push('邻近合计/交易锚点')
      }
      if (signed) {
        confidence += 0.1
        reasons.push('带收支符号')
      }
      if (heightOf(row.bounds) >= medianHeight * 1.35) {
        confidence += 0.08
        reasons.push('大字号金额')
      }
      if ((row.bounds.left + row.bounds.right) / 2 >= document.width * 0.56) {
        confidence += 0.035
        reasons.push('位于右侧金额区')
      }
      if (amount >= 1 && amount <= 5000) confidence += 0.025
      if (hasNegativeContext) {
        confidence -= 0.32
        reasons.push('同一行存在余额/优惠/退款语义')
      }

      candidates.push({
        value: amount,
        confidence: clamp(confidence),
        text: matchedText,
        rowText: row.text,
        rowIndex: row.index,
        reasons,
        signed: captured.replace(/\s/g, '').startsWith('-'),
        row,
      })
    }
  }

  return candidates.sort((first, second) => second.confidence - first.confidence)
}

function inferDirection(text: string, hasNegativeAmount = false): TransactionDirection {
  if (/(退款成功|已退款|退款到账|退回|已退)/.test(text)) return 'refund'
  if (/(收入|收款到账|已收款|转入|到账)/.test(text) && !/(付款|支出|消费)/.test(text)) {
    return 'income'
  }
  if (hasNegativeAmount || /(支付成功|付款成功|支出|消费|已支付|转账成功|扣款)/.test(text)) {
    return 'expense'
  }
  return 'unknown'
}

function inferPaymentMethod(text: string) {
  if (/支付宝|alipay/i.test(text)) return '支付宝'
  if (/微信|wechat|零钱通|零钱/i.test(text)) return '微信'
  if (/银行卡|银行|信用卡|储蓄卡|云闪付|尾号\s*\d{3,4}/i.test(text)) return '银行卡'
  if (/(群收款|收支统计|全部账单|查找交易|零钱通)/.test(text)) return '微信'
  return '其他'
}

function inferCategory(text: string) {
  return categoryRules.find(([, pattern]) => pattern.test(text))?.[0] ?? '其他'
}

function validDate(year: number, month: number, day: number) {
  const parsed = new Date(year, month - 1, day)
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return null
  }
  return localDate(parsed)
}

function extractDate(text: string, now: Date) {
  const normalized = normalizeOcrText(text)
  const full = normalized.match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?/)
  if (full) return validDate(Number(full[1]), Number(full[2]), Number(full[3]))
  const short = normalized.match(/(?:^|\s)(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?(?:\s|$)/)
  if (short) {
    const month = Number(short[1])
    const day = Number(short[2])
    const thisYear = validDate(now.getFullYear(), month, day)
    if (!thisYear) return null
    return thisYear <= localDate(now)
      ? thisYear
      : validDate(now.getFullYear() - 1, month, day)
  }
  return null
}

function nearestDate(rows: LogicalRow[], rowIndex: number, now: Date) {
  for (let distance = 0; distance <= 4; distance += 1) {
    for (const index of [rowIndex - distance, rowIndex + distance]) {
      const row = rows[index]
      if (!row) continue
      const date = extractDate(row.text, now)
      if (date) return date
    }
  }
  return null
}

function extractMerchant(rows: LogicalRow[], fullText: string) {
  const anchored = rows
    .map((row) => row.text)
    .map((text) =>
      text.match(/(?:商户(?:名称)?|收款方|付款给|交易对象|对方|商品说明)\s*[:：]?\s*(.{2,40})$/)?.[1]
        ?.replace(/\s+/g, ' ')
        .trim(),
    )
    .find(Boolean)
  if (anchored) return anchored

  const candidates = rows
    .map((row) => row.text.replace(/\s+/g, ' ').trim())
    .filter(
      (text) =>
        text.length >= 2 &&
        text.length <= 36 &&
        !new RegExp(MONEY_PATTERN.source, 'i').test(text) &&
        !/(支付成功|付款成功|交易成功|账单详情|交易详情|全部账单|收支统计|订单号|商户单号|创建时间|支付时间|当前状态|查看往来|联系商家)/.test(
          text,
        ) &&
        !/(20\d{2})\s*[-/.年]/.test(text) &&
        !/^\d{1,2}[:：]\d{2}/.test(text),
    )
  return candidates.find((text) => /[\u4e00-\u9fa5]{2,}/.test(text)) ?? (fullText ? '截图识别' : '')
}

function cleanListNote(rowText: string) {
  return rowText
    .replace(/20\d{2}\s*[-/.年]\s*\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?/g, ' ')
    .replace(/(?:^|\s)\d{1,2}\s*[-/.月]\s*\d{1,2}\s*日?(?=\s|$)/g, ' ')
    .replace(/\b\d{1,2}[:：]\d{2}(?::\d{2})?\b/g, ' ')
    .replace(new RegExp(MONEY_PATTERN.source, MONEY_PATTERN.flags), ' ')
    .replace(/(交易成功|支付成功|付款成功|支出)/g, ' ')
    .replace(/[|·•]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40)
}

function uniqueCandidates(candidates: CandidateWithGeometry[]) {
  const byValue = new Map<string, CandidateWithGeometry>()
  for (const candidate of candidates) {
    const key = candidate.value.toFixed(2)
    const existing = byValue.get(key)
    if (!existing || candidate.confidence > existing.confidence) byValue.set(key, candidate)
  }
  return [...byValue.values()].sort((first, second) => second.confidence - first.confidence)
}

function makeTransaction(
  document: OcrDocument,
  rows: LogicalRow[],
  candidate: CandidateWithGeometry | null,
  alternatives: CandidateWithGeometry[],
  now: Date,
  sourceRow?: string,
): ParsedTransaction {
  const relevantText = sourceRow ?? document.text
  const direction = inferDirection(relevantText || document.text, candidate?.signed)
  const date = candidate ? nearestDate(rows, candidate.rowIndex, now) : extractDate(document.text, now)
  const merchant = sourceRow ? cleanListNote(sourceRow) : extractMerchant(rows, document.text)
  const warnings: string[] = []
  const second = alternatives.find((item) => candidate && item.value !== candidate.value)

  if (!candidate) warnings.push('没有找到可靠金额')
  if (candidate && candidate.confidence < 0.78) warnings.push('金额置信度偏低')
  if (second && candidate && candidate.confidence - second.confidence < 0.08) {
    warnings.push('存在多个接近的金额候选')
  }
  if (direction === 'income') warnings.push('识别结果更像收入')
  if (direction === 'refund') warnings.push('识别结果更像退款')
  if (direction === 'unknown') warnings.push('无法稳定判断收支方向')

  const documentConfidence =
    document.lines.reduce((sum, line) => sum + line.confidence, 0) / Math.max(document.lines.length, 1)
  let confidence = (candidate?.confidence ?? 0) * 0.72 + documentConfidence * 0.12
  if (merchant && merchant !== '截图识别') confidence += 0.07
  if (direction === 'expense') confidence += 0.09
  if (warnings.includes('存在多个接近的金额候选')) confidence -= 0.1

  return {
    amount: candidate?.value ?? null,
    category: inferCategory(relevantText),
    date: date ?? localDate(now),
    note: merchant || '截图识别',
    paymentMethod: inferPaymentMethod(document.text),
    direction,
    confidence: clamp(confidence),
    amountCandidate: candidate,
    alternatives: alternatives.slice(0, 5),
    warnings,
    sourceRow,
  }
}

export function parseOcrDocument(document: OcrDocument, now = new Date()): ParsedOcrResult {
  const rows = buildRows(document)
  const allCandidates = extractAmountCandidates(document, rows)
  const signedExpenseCandidates = allCandidates.filter(
    (candidate) => candidate.signed && inferDirection(candidate.rowText, true) === 'expense',
  )
  const isBillList =
    (BILL_LIST_UI.test(document.text) && signedExpenseCandidates.length >= 2) ||
    signedExpenseCandidates.length >= 3
  const documentConfidence =
    document.lines.reduce((sum, line) => sum + line.confidence, 0) / Math.max(document.lines.length, 1)

  if (isBillList) {
    const seenRows = new Set<number>()
    const transactions = signedExpenseCandidates
      .filter((candidate) => {
        if (seenRows.has(candidate.rowIndex)) return false
        seenRows.add(candidate.rowIndex)
        return true
      })
      .sort((first, second) => first.row.bounds.top - second.row.bounds.top)
      .slice(0, 30)
      .map((candidate) =>
        makeTransaction(document, rows, candidate, [candidate], now, candidate.rowText),
      )
    return { transactions, isBillList: true, documentConfidence }
  }

  const alternatives = uniqueCandidates(allCandidates)
  const best = alternatives[0] ?? null
  return {
    transactions: [makeTransaction(document, rows, best, alternatives, now)],
    isBillList: false,
    documentConfidence,
  }
}

export function formatOcrReview(document: OcrDocument, parsed: ParsedOcrResult) {
  const time = document.metrics.totalTimeMs ? `${document.metrics.totalTimeMs} ms` : '未记录'
  const header = [
    `【识别引擎】${document.engine}`,
    `【耗时】${time}`,
    `【平均置信度】${Math.round(parsed.documentConfidence * 100)}%`,
  ]

  const fields = parsed.transactions.slice(0, 8).map((transaction, index) => {
    const label = parsed.transactions.length > 1 ? `候选 ${index + 1}` : '解析结果'
    return `【${label}】金额 ${transaction.amount?.toFixed(2) ?? '未识别'}，置信度 ${Math.round(
      transaction.confidence * 100,
    )}%，${transaction.note}`
  })
  const lines = buildRows(document).map(
    (row) => `[${String(Math.round(row.confidence * 100)).padStart(3, ' ')}%] ${row.text}`,
  )
  return [...header, ...fields, '', '【识别文本】', ...lines].join('\n')
}
