import tesseract from 'tesseract.js'

const { recognize } = tesseract

const imagePath = process.argv[2]
const langs = process.argv[3] ?? 'chi_sim+eng'

if (!imagePath) {
  console.error('Usage: node scripts/probe-ocr.mjs <image-path>')
  process.exit(1)
}

function normalizeText(text) {
  const fullWidthDigits = '０１２３４５６７８９'
  return text
    .replace(/[０-９]/g, (char) => String(fullWidthDigits.indexOf(char)))
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[￥]/g, '¥')
    .replace(/[−–—]/g, '-')
    .replace(/(^|\s)一\s*(?=\d)/g, '$1-')
}

function isBillListText(rawText) {
  const text = normalizeText(rawText)
  const hasBillListUi = /(账单|全部账单|查找交易|收支统计|交易记录|月账单)/.test(text)
  const hasMonthSummary = /支出\s*[¥￥]?\s*\d{1,6}(?:[,.]\d{1,2})?.{0,24}收入\s*[¥￥]?\s*\d{1,6}/s.test(
    text,
  )
  const signedAmountCount = text.match(/[+-]\s*\d{1,6}(?:[,.]\d{1,2})/g)?.length ?? 0

  return (hasBillListUi && (hasMonthSummary || signedAmountCount >= 2)) || signedAmountCount >= 4
}

function getBillListExpenseLines(rawText) {
  if (!isBillListText(rawText)) return []

  return normalizeText(rawText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false
      if (/支出.{0,24}收入|收入.{0,24}支出|收支统计|全部账单|查找交易/.test(line)) {
        return false
      }
      if (/[+]\s*\d{1,6}(?:[,.]\d{1,2})/.test(line)) return false
      if (/(来自|收入|到账|退款|退回|余额|红包|优惠)/.test(line)) return false
      return /-\s*\d{1,6}(?:[,.]\d{1,2})/.test(line)
    })
}

function extractAmount(rawText) {
  const text = normalizeText(rawText)
  const firstBillExpenseLine = getBillListExpenseLines(text)[0]

  if (firstBillExpenseLine) {
    const expenseMatch = firstBillExpenseLine.match(/-\s*(\d{1,6}(?:[,.]\d{1,2})?)/)
    const value = expenseMatch ? Number(expenseMatch[1].replace(',', '.')) : null
    if (value && Number.isFinite(value) && value > 0) {
      return {
        amount: value,
        candidates: [
          {
            line: firstBillExpenseLine,
            matched: expenseMatch[0],
            value,
            score: 999,
            reason: 'bill-list-first-expense',
          },
        ],
      }
    }
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const candidates = []
  const amountPattern = /(?:¥|￥|rmb|cny)?\s*([+-]?\d{1,6}(?:[,.]\d{1,2})?)/gi

  for (const line of lines) {
    const lower = line.toLowerCase()
    const hasMoneyContext = /(支付|付款|消费|支出|实付|合计|金额|订单|交易|收款|转账)/.test(line)
    const isNegativeContext = /(退款|退回|收入|到账|余额|优惠|红包|积分)/.test(line)
    const hasCurrency = /[¥￥]|rmb|cny/i.test(line)
    const isUiNoise = /(:|\bkb\/s\b|\b5g\b|\b4g\b|删除|编辑|记录时间|来源)/i.test(line)
    let match

    while ((match = amountPattern.exec(lower)) !== null) {
      const rawMatch = match[1]
      const around = line.slice(Math.max(0, match.index - 8), match.index + match[0].length + 8)
      const hasStrongExpenseAround = /(支付|付款|消费|支出|实付|合计|转账)/.test(around)
      const hasWeakExpenseAround = /(订单|交易|金额)/.test(around)
      const hasNegativeAround = /(退款|退回|收入|到账|余额|优惠|红包|积分)/.test(around)
      const hasDecimal = /[,.]\d{1,2}$/.test(rawMatch)
      const hasSign = /^[+-]/.test(rawMatch)
      const lineOnlyAmount = /^[+-]?\s*(?:¥\s*)?\d{1,6}(?:[,.]\d{1,2})?$/.test(
        line.replace(/\s+/g, ''),
      )

      if ((hasNegativeAround || isNegativeContext) && !hasStrongExpenseAround && !lineOnlyAmount) {
        continue
      }
      if (!hasDecimal && !hasCurrency && !hasMoneyContext && !hasSign) continue

      const value = Number(rawMatch.replace(',', '.').replace(/[+-]/g, ''))
      if (!Number.isFinite(value) || value <= 0 || value > 100000) continue
      if (/^(19|20)\d{2}$/.test(String(Math.trunc(value)))) continue

      let score = 0
      if (hasDecimal) score += 70
      if (lineOnlyAmount) score += 70
      if (hasCurrency) score += 70
      if (hasStrongExpenseAround) score += 90
      else if (hasWeakExpenseAround) score += 30
      else if (hasMoneyContext) score += 10
      if (hasSign) score += 40
      if (hasNegativeAround) score -= hasStrongExpenseAround ? 40 : 90
      if (value >= 1 && value <= 2000) score += 15
      if (isUiNoise && !hasDecimal && !hasCurrency && !hasMoneyContext) score -= 80
      candidates.push({ line, matched: match[0], value, score })
    }
  }

  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  return { amount: best && best.score >= 45 ? best.value : null, candidates }
}

const result = await recognize(imagePath, langs, {
  logger: (message) => {
    if (message.status === 'recognizing text') {
      process.stderr.write(`OCR ${Math.round(message.progress * 100)}%\r`)
    }
  },
})

const parsed = extractAmount(result.data.text)

console.log('\n--- OCR TEXT ---')
console.log(result.data.text)
console.log('--- AMOUNT ---')
console.log(parsed.amount)
console.log('--- CANDIDATES ---')
console.log(JSON.stringify(parsed.candidates.slice(0, 30), null, 2))
