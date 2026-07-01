import {
  Camera,
  CheckCircle2,
  Clock3,
  Download,
  Pencil,
  Images,
  Plus,
  ReceiptText,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { type ChangeEvent, type FormEvent, useMemo, useRef, useState } from 'react'
import './App.css'

type Expense = {
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

type Draft = {
  amount: string
  category: string
  date: string
  note: string
  paymentMethod: string
}

type OcrState = {
  status: 'idle' | 'reading' | 'saved' | 'needs-review' | 'error'
  message: string
  progress: number
  rawText: string
}

const STORAGE_KEY = 'spend-app-expenses-v1'

const createId = () => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  // 局域网 http 等非安全上下文下 crypto.randomUUID 不可用，降级生成一个足够唯一的 id。
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const categories = ['餐饮', '交通', '购物', '转账', '生活', '娱乐', '医疗', '住房', '其他']
const paymentMethods = ['微信', '支付宝', '银行卡', '现金', '其他']

const formatLocalDate = (date = new Date()) => {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

const today = () => formatLocalDate()

const defaultDraft = (): Draft => ({
  amount: '',
  category: '餐饮',
  date: today(),
  note: '',
  paymentMethod: '微信',
})

const moneyFormatter = new Intl.NumberFormat('zh-CN', {
  style: 'currency',
  currency: 'CNY',
})

function sanitizeExpense(item: unknown): Expense | null {
  if (!item || typeof item !== 'object') return null
  const raw = item as Record<string, unknown>
  const amount = typeof raw.amount === 'number' ? raw.amount : Number(raw.amount)
  if (!Number.isFinite(amount) || amount <= 0) return null

  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : createId(),
    amount,
    category: typeof raw.category === 'string' && raw.category ? raw.category : '其他',
    date: typeof raw.date === 'string' && raw.date ? raw.date : today(),
    note: typeof raw.note === 'string' ? raw.note : '',
    paymentMethod:
      typeof raw.paymentMethod === 'string' && raw.paymentMethod ? raw.paymentMethod : '其他',
    source: raw.source === 'screenshot' ? 'screenshot' : 'manual',
    rawText: typeof raw.rawText === 'string' ? raw.rawText : undefined,
    createdAt:
      typeof raw.createdAt === 'string' && raw.createdAt
        ? raw.createdAt
        : new Date().toISOString(),
  }
}

function loadExpenses(): Expense[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitizeExpense).filter((item): item is Expense => item !== null)
  } catch {
    return []
  }
}

function saveExpenses(nextExpenses: Expense[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextExpenses))
    return true
  } catch {
    return false
  }
}

function normalizeText(text: string) {
  const fullWidthDigits = '０１２３４５６７８９'
  return text
    .replace(/[０-９]/g, (char) => String(fullWidthDigits.indexOf(char)))
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[￥]/g, '¥')
    .replace(/[−–—]/g, '-')
    .replace(/(^|\s)一\s*(?=\d)/g, '$1-')
}

function cleanOcrReviewLines(text: string) {
  const seen = new Set<string>()
  return normalizeText(text)
    .split(/\r?\n/)
    .map((line) =>
      line
        .replace(/[^\u4e00-\u9fa5a-zA-Z0-9¥￥.,:：+\-/%()（）【】#·\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter((line) => {
      if (!line) return false
      const readableCount = line.replace(/\s/g, '').match(/[\u4e00-\u9fa5a-zA-Z0-9]/g)?.length ?? 0
      if (readableCount === 0) return false
      if (line.length <= 2 && readableCount < line.length) return false
      if (seen.has(line)) return false
      seen.add(line)
      return true
    })
}

function formatOcrReviewText(focusedText: string, fullText: string) {
  const sections: string[] = []
  const focusedLines = cleanOcrReviewLines(focusedText)
  const fullLines = cleanOcrReviewLines(fullText)

  if (focusedLines.length > 0) {
    sections.push(['【金额区域】', ...focusedLines].join('\n'))
  }

  if (fullLines.length > 0) {
    sections.push(['【整张截图】', ...fullLines].join('\n'))
  }

  return sections.join('\n\n') || '没有识别到可展示的文字'
}

function isBillListText(rawText: string) {
  const text = normalizeText(rawText)
  const hasBillListUi = /(账单|全部账单|查找交易|收支统计|交易记录|月账单)/.test(text)
  const hasMonthSummary = /支出\s*[¥￥]?\s*\d{1,6}(?:[,.]\d{1,2})?.{0,24}收入\s*[¥￥]?\s*\d{1,6}/s.test(
    text,
  )
  const signedAmountCount = text.match(/[+-]\s*\d{1,6}(?:[,.]\d{1,2})/g)?.length ?? 0

  return (hasBillListUi && (hasMonthSummary || signedAmountCount >= 2)) || signedAmountCount >= 4
}

function getBillListExpenseLines(rawText: string) {
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

function parseAmountInput(value: string) {
  return Number(normalizeText(value).replace(',', '.').trim())
}

function extractAmount(rawText: string) {
  const text = normalizeText(rawText)
  const firstBillExpenseLine = getBillListExpenseLines(text)[0]

  if (firstBillExpenseLine) {
    const expenseMatch = firstBillExpenseLine.match(/-\s*(\d{1,6}(?:[,.]\d{1,2})?)/)
    const value = expenseMatch ? Number(expenseMatch[1].replace(',', '.')) : null
    if (value && Number.isFinite(value) && value > 0) return value
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const candidates: Array<{ value: number; score: number }> = []
  const amountPattern = /(?:¥|￥|rmb|cny)?\s*([+-]?\d{1,6}(?:[,.]\d{1,2})?)/gi

  for (const line of lines) {
    const lower = line.toLowerCase()
    const hasMoneyContext = /(支付|付款|消费|支出|实付|合计|金额|订单|交易|收款|转账)/.test(line)
    const isNegativeContext = /(退款|退回|收入|到账|余额|优惠|红包|积分)/.test(line)
    const hasCurrency = /[¥￥]|rmb|cny/i.test(line)
    const isUiNoise = /(:|\bkb\/s\b|\b5g\b|\b4g\b|删除|编辑|记录时间|来源)/i.test(line)
    let match: RegExpExecArray | null

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
      candidates.push({ value, score })
    }
  }

  const best = candidates.sort((a, b) => b.score - a.score)[0]
  return best && best.score >= 45 ? best.value : null
}

function extractDate(rawText: string) {
  const text = normalizeText(rawText)
  const dateMatch =
    text.match(/(20\d{2})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/) ??
    text.match(/(\d{1,2})\s*[-/.月]\s*(\d{1,2})日?/)

  if (!dateMatch) return today()

  const now = new Date()
  const year = dateMatch.length === 4 ? Number(dateMatch[1]) : now.getFullYear()
  const month = Number(dateMatch.length === 4 ? dateMatch[2] : dateMatch[1])
  const day = Number(dateMatch.length === 4 ? dateMatch[3] : dateMatch[2])

  if (month < 1 || month > 12 || day < 1 || day > 31) return today()

  const parsed = new Date(year, month - 1, day)

  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) {
    return today()
  }
  return formatLocalDate(parsed)
}

function inferCategory(rawText: string) {
  const text = (getBillListExpenseLines(rawText)[0] ?? rawText).toLowerCase()
  const rules: Array<[string, RegExp]> = [
    ['餐饮', /(餐|饭|外卖|美团|饿了么|咖啡|奶茶|食|麦当劳|肯德基|瑞幸|星巴克)/],
    ['交通', /(地铁|公交|滴滴|打车|高德|铁路|机票|停车|加油|高速)/],
    ['购物', /(淘宝|天猫|京东|拼多多|抖音商城|购物|超市|便利店|盒马|山姆)/],
    ['转账', /(转账|转给|转 给|收款|付款码)/],
    ['娱乐', /(电影|游戏|会员|ktv|演出|音乐|视频|剧院)/],
    ['医疗', /(医院|药|医疗|挂号|诊所|体检)/],
    ['住房', /(房租|物业|水费|电费|燃气|宽带)/],
  ]
  return rules.find(([, pattern]) => pattern.test(text))?.[0] ?? '其他'
}

function extractNote(rawText: string) {
  const firstBillExpenseLine = getBillListExpenseLines(rawText)[0]
  if (firstBillExpenseLine) {
    return (
      firstBillExpenseLine
        .replace(/[-+]\s*\d{1,6}(?:[,.]\d{1,2})\s*$/, '')
        .replace(/^\S\s+/, '')
        .replace(/\s+/g, '')
        .trim() || '账单截图'
    )
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const remark = lines.find((line) => /备注|转账|转给|转 给|商户|商品/.test(line))
  if (remark) return remark.replace(/^备注\s*/, '').trim() || '截图识别'

  return (
    lines.find(
      (line) =>
        line.length > 2 &&
        !/^[+-]?\s*(?:¥\s*)?\d{1,6}(?:[,.]\d{1,2})?$/.test(normalizeText(line)) &&
        !/^\d{1,2}[:：]\d{1,2}/.test(line),
    ) ?? '截图识别'
  )
}

function inferPaymentMethod(rawText: string) {
  if (/微信|wechat/i.test(rawText)) return '微信'
  if (/支付宝|alipay/i.test(rawText)) return '支付宝'
  if (/银行卡|银行|信用卡|储蓄卡|云闪付/i.test(rawText)) return '银行卡'
  if (isBillListText(rawText) && /(群收款|收支统计|全部账单|查找交易|转账)/.test(rawText)) {
    return '微信'
  }
  return '其他'
}

function createExpense(draft: Draft, source: Expense['source'], rawText?: string): Expense {
  return {
    id: createId(),
    amount: Number(draft.amount),
    category: draft.category,
    date: draft.date,
    note: draft.note.trim(),
    paymentMethod: draft.paymentMethod,
    source,
    rawText,
    createdAt: new Date().toISOString(),
  }
}

async function createFocusedAmountImage(file: File) {
  const bitmap = await createImageBitmap(file)
  const crop = {
    x: Math.round(bitmap.width * 0.26),
    y: Math.round(bitmap.height * 0.18),
    width: Math.round(bitmap.width * 0.52),
    height: Math.round(bitmap.height * 0.16),
  }
  const scale = 3
  const canvas = document.createElement('canvas')
  canvas.width = crop.width * scale
  canvas.height = crop.height * scale
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) {
    bitmap.close()
    return null
  }

  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(
    bitmap,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    canvas.width,
    canvas.height,
  )
  bitmap.close()

  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const { data } = imageData
  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
    const value = gray < 175 ? 0 : 255
    data[index] = value
    data[index + 1] = value
    data[index + 2] = value
  }
  context.putImageData(imageData, 0, 0)

  return new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png')
  })
}

const TESSERACT_LOCAL_OPTIONS = {
  // worker 脚本、wasm core、语言模型都指向打包进应用的本地资源，
  // 这样在 APK 里首次识别也无需联网下载，可离线使用。
  workerPath: '/tesseract/worker.min.js',
  corePath: '/tesseract/',
  langPath: '/tesseract/',
  gzip: false,
}

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>

// 常驻复用的 worker：避免每次识别都重建 worker、重新加载 wasm 与语言模型。
// 失败时把缓存的 promise 清空，允许下次重建。
let fullWorkerPromise: Promise<TesseractWorker> | null = null
let focusedWorkerPromise: Promise<TesseractWorker> | null = null
let onFullProgress: ((progress: number) => void) | null = null
let onFocusedProgress: ((progress: number) => void) | null = null

function getFullWorker() {
  if (!fullWorkerPromise) {
    fullWorkerPromise = import('tesseract.js')
      .then((mod) =>
        mod.createWorker('chi_sim', undefined, {
          ...TESSERACT_LOCAL_OPTIONS,
          logger: (message) => {
            if (message.status === 'recognizing text') onFullProgress?.(message.progress)
          },
        }),
      )
      .catch((error) => {
        fullWorkerPromise = null
        throw error
      })
  }
  return fullWorkerPromise
}

function getFocusedWorker() {
  if (!focusedWorkerPromise) {
    focusedWorkerPromise = import('tesseract.js')
      .then((mod) =>
        mod.createWorker('eng', undefined, {
          ...TESSERACT_LOCAL_OPTIONS,
          logger: (message) => {
            if (message.status === 'recognizing text') onFocusedProgress?.(message.progress)
          },
        }),
      )
      .catch((error) => {
        focusedWorkerPromise = null
        throw error
      })
  }
  return focusedWorkerPromise
}

function App() {
  const [expenses, setExpenses] = useState<Expense[]>(() => loadExpenses())
  const [draft, setDraft] = useState<Draft>(() => defaultDraft())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [backupMessage, setBackupMessage] = useState<
    { tone: 'ok' | 'error'; text: string } | null
  >(null)
  const [ocr, setOcr] = useState<OcrState>({
    status: 'idle',
    message: '上传微信、支付宝、银行卡消费截图，识别到金额后会自动入账。',
    progress: 0,
    rawText: '',
  })
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)

  const sortedExpenses = useMemo(
    () =>
      [...expenses].sort((a, b) => {
        const byDate = b.date.localeCompare(a.date)
        return byDate || b.createdAt.localeCompare(a.createdAt)
      }),
    [expenses],
  )

  const monthKey = today().slice(0, 7)
  const monthExpenses = expenses.filter((item) => item.date.startsWith(monthKey))
  const monthTotal = monthExpenses.reduce((sum, item) => sum + item.amount, 0)
  const todayTotal = expenses
    .filter((item) => item.date === today())
    .reduce((sum, item) => sum + item.amount, 0)
  const averageDaily = monthTotal / Math.max(1, new Date().getDate())

  const categoryTotals = categories
    .map((category) => ({
      category,
      total: monthExpenses
        .filter((item) => item.category === category)
        .reduce((sum, item) => sum + item.amount, 0),
    }))
    .filter((item) => item.total > 0)
    .sort((a, b) => b.total - a.total)
  const topCategory = categoryTotals[0]

  const persist = (nextExpenses: Expense[]) => {
    setExpenses(nextExpenses)
    const ok = saveExpenses(nextExpenses)
    setStorageError(
      ok
        ? null
        : '本地保存失败：存储空间可能已满，或浏览器禁用了本地存储，数据可能在刷新后丢失。',
    )
  }

  const handleDraftChange = (key: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amount = parseAmountInput(draft.amount)
    if (!Number.isFinite(amount) || amount <= 0) return

    if (editingId) {
      persist(
        expenses.map((expense) =>
          expense.id === editingId
            ? {
                ...expense,
                amount,
                category: draft.category,
                date: draft.date,
                note: draft.note.trim(),
                paymentMethod: draft.paymentMethod,
              }
            : expense,
        ),
      )
      setEditingId(null)
    } else {
      persist([createExpense({ ...draft, amount: amount.toFixed(2) }, 'manual'), ...expenses])
    }

    setDraft(defaultDraft())
  }

  const deleteExpense = (id: string) => {
    persist(expenses.filter((expense) => expense.id !== id))
    if (editingId === id) {
      setEditingId(null)
      setDraft(defaultDraft())
    }
  }

  const startEdit = (expense: Expense) => {
    setEditingId(expense.id)
    setDraft({
      amount: expense.amount.toFixed(2),
      category: expense.category,
      date: expense.date,
      note: expense.note,
      paymentMethod: expense.paymentMethod,
    })
  }

  const cancelEdit = () => {
    setEditingId(null)
    setDraft(defaultDraft())
  }

  const applyOcrText = (rawText: string, reviewText = rawText) => {
    const amount = extractAmount(rawText)
    const nextDraft: Draft = {
      amount: amount?.toFixed(2) ?? '',
      category: inferCategory(rawText),
      date: extractDate(rawText),
      note: extractNote(rawText),
      paymentMethod: inferPaymentMethod(rawText),
    }

    setDraft(nextDraft)

    if (!amount) {
      setOcr({
        status: 'needs-review',
        message: '没有稳定识别到金额，已把识别文本放到下方，可手动补金额后保存。',
        progress: 1,
        rawText: reviewText,
      })
      return
    }

    const expense = createExpense(nextDraft, 'screenshot', rawText)
    setEditingId(null)
    persist([expense, ...expenses])
    setOcr({
      status: 'saved',
      message: `已自动记录 ${moneyFormatter.format(amount)}，你可以在下方列表里编辑备注或删除。`,
      progress: 1,
      rawText: reviewText,
    })
  }

  const handleScreenshot = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setOcr({
      status: 'reading',
      message: '正在识别截图文字…',
      progress: 0.05,
      rawText: '',
    })

    let focusedAmountImage: Blob | null = null
    try {
      focusedAmountImage = await createFocusedAmountImage(file)
    } catch {
      focusedAmountImage = null
    }

    // 全图识别占进度 70%、金额区复核占 30%（没有金额区时全图占满）。
    // 两次识别在各自的 worker 上并行进行，所以进度按权重合并。
    let fullProgress = 0
    let focusedProgress = 0
    const pushProgress = () => {
      const combined = focusedAmountImage
        ? fullProgress * 0.7 + focusedProgress * 0.3
        : fullProgress
      const value = 0.05 + combined * 0.95
      setOcr((current) => ({
        ...current,
        progress: Math.max(current.progress, value),
        message: `正在识别截图文字 ${Math.round(value * 100)}%`,
      }))
    }
    onFullProgress = (progress) => {
      fullProgress = progress
      pushProgress()
    }
    onFocusedProgress = (progress) => {
      focusedProgress = progress
      pushProgress()
    }

    try {
      const fullWorker = await getFullWorker()
      const [fullResult, focusedResult] = await Promise.all([
        fullWorker.recognize(file),
        focusedAmountImage
          ? getFocusedWorker().then((worker) => worker.recognize(focusedAmountImage as Blob))
          : Promise.resolve(null),
      ])

      const fullText = fullResult.data.text
      const focusedText = focusedResult?.data.text ?? ''
      const shouldUseFocusedText = !isBillListText(fullText)
      applyOcrText(
        [shouldUseFocusedText ? focusedText : '', fullText].filter(Boolean).join('\n'),
        formatOcrReviewText(shouldUseFocusedText ? focusedText : '', fullText),
      )
    } catch (error) {
      setOcr({
        status: 'error',
        message: error instanceof Error ? error.message : '截图识别失败，请换一张更清晰的截图。',
        progress: 0,
        rawText: '',
      })
    } finally {
      onFullProgress = null
      onFocusedProgress = null
      event.target.value = ''
    }
  }

  const exportData = () => {
    if (expenses.length === 0) return
    try {
      const payload = JSON.stringify(
        { app: 'spend-app', version: 1, exportedAt: new Date().toISOString(), expenses },
        null,
        2,
      )
      const blob = new Blob([payload], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `记账备份-${today()}.json`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
      setBackupMessage({ tone: 'ok', text: `已导出 ${expenses.length} 笔记录到 JSON 文件。` })
    } catch {
      setBackupMessage({ tone: 'error', text: '导出失败，请重试。' })
    }
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const text = await file.text()
      const parsed = JSON.parse(text)
      const rawList = Array.isArray(parsed)
        ? parsed
        : Array.isArray(parsed?.expenses)
          ? parsed.expenses
          : null

      if (!rawList) {
        setBackupMessage({ tone: 'error', text: '导入失败：文件格式不正确。' })
        return
      }

      const imported = rawList
        .map(sanitizeExpense)
        .filter((item: Expense | null): item is Expense => item !== null)

      const existingIds = new Set(expenses.map((item) => item.id))
      const added: Expense[] = []
      for (const item of imported) {
        if (existingIds.has(item.id)) continue
        existingIds.add(item.id)
        added.push(item)
      }

      if (added.length === 0) {
        setBackupMessage({
          tone: 'ok',
          text:
            imported.length > 0
              ? '导入完成：没有新增记录（全部已存在）。'
              : '没有可导入的有效记录。',
        })
        return
      }

      persist([...added, ...expenses])
      const skipped = imported.length - added.length
      setBackupMessage({
        tone: 'ok',
        text: `已导入 ${added.length} 笔记录${skipped > 0 ? `，跳过 ${skipped} 笔重复` : ''}。`,
      })
    } catch {
      setBackupMessage({ tone: 'error', text: '导入失败：文件无法解析。' })
    } finally {
      event.target.value = ''
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">实时个人记账</p>
          <h1>我的账本</h1>
        </div>
        <button
          className="icon-button"
          type="button"
          title="从相册选择截图"
          onClick={() => galleryInputRef.current?.click()}
        >
          <Images size={22} />
        </button>
      </header>

      {storageError ? (
        <div className="storage-alert" role="alert">
          {storageError}
        </div>
      ) : null}

      <section className="overview-panel" aria-label="支出概览">
        <div className="overview-main">
          <span>今日支出</span>
          <strong>{moneyFormatter.format(todayTotal)}</strong>
          <p>
            {topCategory
              ? `本月最多花在${topCategory.category}，共 ${moneyFormatter.format(topCategory.total)}`
              : '上传消费截图后会自动生成账单'}
          </p>
        </div>
        <div className="overview-metrics">
          <div>
            <span>本月</span>
            <strong>{moneyFormatter.format(monthTotal)}</strong>
          </div>
          <div>
            <span>日均</span>
            <strong>{moneyFormatter.format(averageDaily)}</strong>
          </div>
          <div>
            <span>笔数</span>
            <strong>{expenses.length}</strong>
          </div>
        </div>
      </section>

      <section className="capture-panel">
        <input
          ref={galleryInputRef}
          className="hidden-input"
          type="file"
          accept="image/*"
          onChange={handleScreenshot}
        />
        <input
          ref={cameraInputRef}
          className="hidden-input"
          type="file"
          accept="image/*"
          capture="environment"
          onChange={handleScreenshot}
        />
        <div className="capture-copy">
          <span className="panel-icon">
            <ReceiptText size={22} />
          </span>
          <div>
            <h2>截图自动入账</h2>
            <p>{ocr.message}</p>
          </div>
        </div>
        {ocr.status === 'reading' ? (
          <div className="progress-track">
            <span style={{ width: `${Math.round(ocr.progress * 100)}%` }} />
          </div>
        ) : null}
        <div className="capture-actions">
          <button
            className="primary-action"
            type="button"
            onClick={() => galleryInputRef.current?.click()}
          >
            <Upload size={20} />
            从相册选择截图
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera size={20} />
            拍照识别
          </button>
        </div>
      </section>

      <form className="entry-form" onSubmit={handleSubmit}>
        <div className="form-heading">
          <div>
            <span className="section-kicker">快速录入</span>
            <h2>{editingId ? '修改记录' : '手动记一笔'}</h2>
          </div>
          {editingId ? (
            <button className="ghost-button" type="button" title="取消编辑" onClick={cancelEdit}>
              <X size={17} />
            </button>
          ) : null}
        </div>

        <div className="field amount-field">
          <label htmlFor="amount">金额</label>
          <input
            id="amount"
            inputMode="decimal"
            placeholder="0.00"
            value={draft.amount}
            onChange={(event) => handleDraftChange('amount', event.target.value)}
          />
        </div>

        <div className="field-row">
          <label className="field">
            分类
            <select
              value={draft.category}
              onChange={(event) => handleDraftChange('category', event.target.value)}
            >
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            日期
            <input
              type="date"
              value={draft.date}
              onChange={(event) => handleDraftChange('date', event.target.value)}
            />
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            支付方式
            <select
              value={draft.paymentMethod}
              onChange={(event) => handleDraftChange('paymentMethod', event.target.value)}
            >
              {paymentMethods.map((method) => (
                <option key={method} value={method}>
                  {method}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            备注
            <input
              placeholder="例如 午饭、打车"
              value={draft.note}
              onChange={(event) => handleDraftChange('note', event.target.value)}
            />
          </label>
        </div>

        <button className="primary-action" type="submit">
          {editingId ? <CheckCircle2 size={20} /> : <Plus size={20} />}
          {editingId ? '保存修改' : '记一笔'}
        </button>
      </form>

      <section className="stats-section">
        <div className="section-title">
          <h2>本月分类</h2>
          <span>{categoryTotals.length} 类</span>
        </div>
        {categoryTotals.length > 0 ? (
          <div className="category-list">
            {categoryTotals.map((item) => (
              <div className="category-row" key={item.category}>
                <div>
                  <span>{item.category}</span>
                  <strong>{moneyFormatter.format(item.total)}</strong>
                </div>
                <div className="bar">
                  <span style={{ width: `${Math.max(8, (item.total / monthTotal) * 100)}%` }} />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-text">本月还没有支出记录。</p>
        )}
      </section>

      <section className="records-section">
        <div className="section-title">
          <h2>最近记录</h2>
          <span>{sortedExpenses.length} 笔</span>
        </div>

        {sortedExpenses.length > 0 ? (
          <ul className="expense-list">
            {sortedExpenses.map((expense) => (
              <li className="expense-item" key={expense.id}>
                <div className="expense-main">
                  <span className="category-pill" data-category={expense.category}>
                    {expense.category}
                  </span>
                  <div>
                    <strong>{expense.note || '未填写备注'}</strong>
                    <p>
                      <Clock3 size={14} />
                      {expense.date} · {expense.paymentMethod}
                      {expense.source === 'screenshot' ? ' · 截图识别' : ''}
                    </p>
                  </div>
                </div>
                <div className="expense-side">
                  <strong>{moneyFormatter.format(expense.amount)}</strong>
                  <div className="expense-actions">
                    <button
                      className="ghost-button"
                      type="button"
                      title="编辑记录"
                      onClick={() => startEdit(expense)}
                    >
                      <Pencil size={17} />
                    </button>
                    <button
                      className="ghost-button danger-button"
                      type="button"
                      title="删除记录"
                      onClick={() => deleteExpense(expense.id)}
                    >
                      <Trash2 size={17} />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="empty-state">
            <span className="empty-icon">
              <CheckCircle2 size={28} />
            </span>
            <p>上传消费截图或手动记一笔，第一条记录会出现在这里。</p>
          </div>
        )}
      </section>

      <section className="backup-section">
        <div className="section-title">
          <h2>数据备份</h2>
          <span>{expenses.length} 笔</span>
        </div>
        <input
          ref={importInputRef}
          className="hidden-input"
          type="file"
          accept="application/json,.json"
          onChange={handleImport}
        />
        <div className="backup-actions">
          <button
            className="secondary-action"
            type="button"
            onClick={exportData}
            disabled={expenses.length === 0}
          >
            <Download size={20} />
            导出 JSON
          </button>
          <button
            className="secondary-action"
            type="button"
            onClick={() => importInputRef.current?.click()}
          >
            <Upload size={20} />
            导入 JSON
          </button>
        </div>
        {backupMessage ? (
          <p className={`backup-message ${backupMessage.tone === 'ok' ? 'is-ok' : 'is-error'}`}>
            {backupMessage.text}
          </p>
        ) : null}
        <p className="backup-hint">
          导出文件请妥善保存。导入会与现有记录按 id 合并去重，不会覆盖已有数据。
        </p>
      </section>

      {ocr.rawText ? (
        <details className="ocr-details">
          <summary>
            <Pencil size={16} />
            查看最近一次识别文本
          </summary>
          <pre>{ocr.rawText}</pre>
        </details>
      ) : null}
    </main>
  )
}

export default App
