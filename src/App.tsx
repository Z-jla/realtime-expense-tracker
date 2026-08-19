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
import { formatOcrReview, normalizeOcrText, parseOcrDocument } from './ocr/parser.ts'
import { recognizeExpenseImage } from './ocr/recognize.ts'
import type { OcrDocument, ParsedTransaction } from './ocr/types.ts'

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
  engine?: string
  confidence?: number
}

type BatchCandidate = ParsedTransaction & {
  selected: boolean
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

function parseAmountInput(value: string) {
  return Number(normalizeOcrText(value).replace(',', '.').trim())
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

function draftFromTransaction(transaction: ParsedTransaction): Draft {
  return {
    amount: transaction.amount?.toFixed(2) ?? '',
    category: transaction.category,
    date: transaction.date,
    note: transaction.note,
    paymentMethod: transaction.paymentMethod,
  }
}

function normalizedNote(note: string) {
  return note.replace(/\s+/g, '').replace(/截图识别|账单截图/g, '').toLowerCase()
}

function isDuplicateDraft(draft: Draft, expenses: Expense[]) {
  const amount = Number(draft.amount)
  const note = normalizedNote(draft.note)
  return expenses.some(
    (expense) =>
      Math.abs(expense.amount - amount) < 0.001 &&
      expense.date === draft.date &&
      expense.paymentMethod === draft.paymentMethod &&
      normalizedNote(expense.note) === note,
  )
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
    message: '上传支付截图或购物小票，高置信度结果会自动入账，其余先请你确认。',
    progress: 0,
    rawText: '',
  })
  const [ocrBatch, setOcrBatch] = useState<BatchCandidate[]>([])
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const expensesRef = useRef(expenses)
  const pendingOcrTextRef = useRef<string | null>(null)
  expensesRef.current = expenses

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
    expensesRef.current = nextExpenses
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
    const recognizedRawText = pendingOcrTextRef.current

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
      const source = recognizedRawText ? 'screenshot' : 'manual'
      persist([
        createExpense(
          { ...draft, amount: amount.toFixed(2) },
          source,
          recognizedRawText ?? undefined,
        ),
        ...expenses,
      ])
    }

    pendingOcrTextRef.current = null
    setDraft(defaultDraft())
    if (recognizedRawText) {
      setOcr((current) => ({
        ...current,
        status: 'saved',
        message: `已确认记录 ${moneyFormatter.format(amount)}。`,
      }))
    }
  }

  const deleteExpense = (id: string) => {
    persist(expenses.filter((expense) => expense.id !== id))
    if (editingId === id) {
      setEditingId(null)
      setDraft(defaultDraft())
    }
  }

  const startEdit = (expense: Expense) => {
    pendingOcrTextRef.current = null
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
    pendingOcrTextRef.current = null
    setEditingId(null)
    setDraft(defaultDraft())
  }

  const applyOcrDocument = (document: OcrDocument) => {
    const parsed = parseOcrDocument(document)
    const reviewText = formatOcrReview(document, parsed)
    pendingOcrTextRef.current = document.text
    setEditingId(null)

    if (parsed.isBillList && parsed.transactions.length > 1) {
      setOcrBatch(parsed.transactions.map((transaction) => ({ ...transaction, selected: true })))
      setDraft(defaultDraft())
      setOcr({
        status: 'needs-review',
        message: `识别到 ${parsed.transactions.length} 笔支出，请勾选后批量入账。`,
        progress: 1,
        rawText: reviewText,
        engine: document.engine,
        confidence: parsed.documentConfidence,
      })
      return
    }

    setOcrBatch([])
    const transaction = parsed.transactions[0]
    if (!transaction) {
      setDraft(defaultDraft())
      setOcr({
        status: 'needs-review',
        message: '没有识别到可用文字，请换一张更清晰、边缘完整的图片。',
        progress: 1,
        rawText: reviewText,
        engine: document.engine,
        confidence: parsed.documentConfidence,
      })
      return
    }

    const nextDraft = draftFromTransaction(transaction)
    setDraft(nextDraft)
    const autoSaveThreshold = document.engine === 'PP-OCRv6-tiny' ? 0.91 : 0.96
    const canAutoSave =
      transaction.amount !== null &&
      transaction.direction === 'expense' &&
      transaction.confidence >= autoSaveThreshold &&
      transaction.warnings.length === 0

    if (!transaction.amount) {
      setOcr({
        status: 'needs-review',
        message: '没有稳定识别到金额，已填入其他字段，请手动补充后保存。',
        progress: 1,
        rawText: reviewText,
        engine: document.engine,
        confidence: transaction.confidence,
      })
      return
    }

    if (!canAutoSave) {
      const warning = transaction.warnings[0]
      setOcr({
        status: 'needs-review',
        message: warning
          ? `识别到 ${moneyFormatter.format(transaction.amount)}，但${warning}，请确认后保存。`
          : `识别到 ${moneyFormatter.format(transaction.amount)}，请确认商户和金额后保存。`,
        progress: 1,
        rawText: reviewText,
        engine: document.engine,
        confidence: transaction.confidence,
      })
      return
    }

    if (isDuplicateDraft(nextDraft, expensesRef.current)) {
      setOcr({
        status: 'needs-review',
        message: `识别到 ${moneyFormatter.format(transaction.amount)}，但疑似已经入账，请确认是否重复。`,
        progress: 1,
        rawText: reviewText,
        engine: document.engine,
        confidence: transaction.confidence,
      })
      return
    }

    const expense = createExpense(nextDraft, 'screenshot', document.text)
    persist([expense, ...expensesRef.current])
    pendingOcrTextRef.current = null
    setDraft(defaultDraft())
    setOcr({
      status: 'saved',
      message: `已用 ${document.engine} 自动记录 ${moneyFormatter.format(transaction.amount)}。`,
      progress: 1,
      rawText: reviewText,
      engine: document.engine,
      confidence: transaction.confidence,
    })
  }

  const toggleBatchCandidate = (index: number) => {
    setOcrBatch((current) =>
      current.map((candidate, candidateIndex) =>
        candidateIndex === index ? { ...candidate, selected: !candidate.selected } : candidate,
      ),
    )
  }

  const confirmBatchCandidates = () => {
    const selected = ocrBatch.filter(
      (candidate): candidate is BatchCandidate & { amount: number } =>
        candidate.selected && candidate.amount !== null,
    )
    const currentExpenses = [...expensesRef.current]
    const added: Expense[] = []

    for (const candidate of selected) {
      const candidateDraft = draftFromTransaction(candidate)
      if (isDuplicateDraft(candidateDraft, [...added, ...currentExpenses])) continue
      added.push(
        createExpense(candidateDraft, 'screenshot', pendingOcrTextRef.current ?? undefined),
      )
    }

    if (added.length > 0) persist([...added, ...currentExpenses])
    setOcrBatch([])
    pendingOcrTextRef.current = null
    setOcr((current) => ({
      ...current,
      status: added.length > 0 ? 'saved' : 'needs-review',
      message:
        added.length > 0
          ? `已批量记录 ${added.length} 笔支出${added.length < selected.length ? '，重复项已跳过' : ''}。`
          : '没有新增记录：未勾选项目或所选项目均已存在。',
    }))
  }

  const dismissBatchCandidates = () => {
    setOcrBatch([])
    pendingOcrTextRef.current = null
    setOcr((current) => ({ ...current, message: '已取消本次批量导入。' }))
  }

  const handleScreenshot = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    setOcr({
      status: 'reading',
      message: '正在准备离线识别…',
      progress: 0.05,
      rawText: '',
    })
    setOcrBatch([])
    pendingOcrTextRef.current = null

    try {
      const document = await recognizeExpenseImage(file, (progress, message) => {
        setOcr((current) => ({
          ...current,
          status: 'reading',
          progress: Math.max(current.progress, Math.min(0.98, progress)),
          message,
        }))
      })
      applyOcrDocument(document)
    } catch (error) {
      setOcr({
        status: 'error',
        message: error instanceof Error ? error.message : '截图识别失败，请换一张更清晰的截图。',
        progress: 0,
        rawText: '',
      })
    } finally {
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
            <h2>智能识图入账</h2>
            <p>{ocr.message}</p>
            {ocr.engine && ocr.status !== 'reading' ? (
              <div className="ocr-engine-meta">
                <span>{ocr.engine}</span>
                {typeof ocr.confidence === 'number' ? (
                  <span>置信度 {Math.round(ocr.confidence * 100)}%</span>
                ) : null}
              </div>
            ) : null}
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
            disabled={ocr.status === 'reading'}
            onClick={() => galleryInputRef.current?.click()}
          >
            <Upload size={20} />
            从相册选择截图
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={ocr.status === 'reading'}
            onClick={() => cameraInputRef.current?.click()}
          >
            <Camera size={20} />
            拍照识别
          </button>
        </div>
      </section>

      {ocrBatch.length > 0 ? (
        <section className="ocr-batch-panel" aria-label="批量识别结果">
          <div className="section-title">
            <div>
              <span className="section-kicker">账单列表</span>
              <h2>选择要导入的支出</h2>
            </div>
            <span>
              {ocrBatch.filter((candidate) => candidate.selected).length}/{ocrBatch.length} 笔
            </span>
          </div>
          <ul className="ocr-batch-list">
            {ocrBatch.map((candidate, index) => (
              <li key={`${candidate.sourceRow ?? candidate.note}-${index}`}>
                <label>
                  <input
                    type="checkbox"
                    checked={candidate.selected}
                    onChange={() => toggleBatchCandidate(index)}
                  />
                  <span className="ocr-batch-copy">
                    <strong>{candidate.note || '未识别商户'}</strong>
                    <small>
                      {candidate.date} · {candidate.category} · 置信度{' '}
                      {Math.round(candidate.confidence * 100)}%
                    </small>
                  </span>
                  <strong className="ocr-batch-amount">
                    {candidate.amount === null ? '待确认' : moneyFormatter.format(candidate.amount)}
                  </strong>
                </label>
              </li>
            ))}
          </ul>
          <div className="capture-actions">
            <button className="secondary-action" type="button" onClick={dismissBatchCandidates}>
              <X size={19} />
              取消
            </button>
            <button className="primary-action" type="button" onClick={confirmBatchCandidates}>
              <CheckCircle2 size={19} />
              批量入账
            </button>
          </div>
        </section>
      ) : null}

      <form className="entry-form" onSubmit={handleSubmit}>
        <div className="form-heading">
          <div>
            <span className="section-kicker">
              {ocr.status === 'needs-review' && ocrBatch.length === 0 ? '识别复核' : '快速录入'}
            </span>
            <h2>
              {editingId
                ? '修改记录'
                : ocr.status === 'needs-review' && ocrBatch.length === 0
                  ? '确认识别结果'
                  : '手动记一笔'}
            </h2>
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
          {editingId
            ? '保存修改'
            : ocr.status === 'needs-review' && ocrBatch.length === 0
              ? '确认入账'
              : '记一笔'}
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
