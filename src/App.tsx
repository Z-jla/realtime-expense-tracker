import { Capacitor } from '@capacitor/core'
import {
  BarChart3,
  ChevronDown,
  CirclePlus,
  Images,
  ReceiptText,
  RotateCcw,
  ScanText,
  Settings2,
} from 'lucide-react'
import {
  type ChangeEvent,
  type FormEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import './App.css'
import {
  createAutomaticBackupController,
  readAutomaticBackup,
  type AutomaticBackupStatus,
} from './autoBackup.ts'
import BackupPanel from './components/BackupPanel.tsx'
import CategoryStats from './components/CategoryStats.tsx'
import EntryForm from './components/EntryForm.tsx'
import ExpenseRecords from './components/ExpenseRecords.tsx'
import MonthOverview from './components/MonthOverview.tsx'
import OcrBatchPanel, { type BatchCandidate } from './components/OcrBatchPanel.tsx'
import OcrCapturePanel from './components/OcrCapturePanel.tsx'
import SettingsPanel from './components/SettingsPanel.tsx'
import {
  availableCategories,
  createExpense,
  defaultDraft,
  isValidExpenseAmount,
  isValidExpenseDate,
  MAX_EXPENSE_AMOUNT,
  mergeImportedExpenses,
  moneyFormatter,
  parseAmountInput,
  sanitizeExpense,
  type AppSettings,
  type Draft,
  type Expense,
} from './expenses.ts'
import {
  captureNativeImages,
  isNativeCaptureCancellation,
  isNativeCapturePermissionDenied,
  MAX_GALLERY_SELECTION,
  type NativeCaptureSource,
} from './ocr/capture.ts'
import {
  decideOcrDocument,
  ocrReviewMessage,
  prepareOcrDocumentBatch,
  reconcileOcrBatchExpenses,
  type OcrDocumentTransactionGroup,
} from './ocr/decision.ts'
import { formatOcrReview, parseOcrDocument } from './ocr/parser.ts'
import { recognizeExpenseImage, recognizeNativeExpenseImage } from './ocr/recognize.ts'
import type { OcrDocument, OcrUiState } from './ocr/types.ts'
import {
  getStoredAppDataPresence,
  loadExpenses,
  loadSettings,
  saveExpenses,
  saveSettings,
} from './storage.ts'
import { useToday } from './useToday.ts'

const SECTION_IDS = ['overview', 'entry', 'records', 'settings'] as const

function formatHeaderDate(value: string) {
  const [year, month, day] = value.split('-').map(Number)
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(year, month - 1, day))
}

function App() {
  const today = useToday()
  const currentMonth = today.slice(0, 7)
  const [selectedMonth, setSelectedMonth] = useState(currentMonth)
  const [expenses, setExpenses] = useState<Expense[]>(() => loadExpenses())
  const [settings, setSettings] = useState<AppSettings>(() => loadSettings())
  const [shouldRestoreSnapshot] = useState(() => {
    // 任一数据分区缺失或损坏时检查快照；恢复逻辑只覆盖缺失的那一部分。
    // 首次启动尚未写入 settings 也会进入一次检查，完成后默认设置会落盘。
    const presence = getStoredAppDataPresence()
    return !presence.expenses || !presence.settings
  })
  const [backupReady, setBackupReady] = useState(
    () => !Capacitor.isNativePlatform() || !shouldRestoreSnapshot,
  )
  const [draft, setDraft] = useState<Draft>(() => defaultDraft())
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formError, setFormError] = useState<{
    field: 'amount' | 'date'
    message: string
  } | null>(null)
  const [storageError, setStorageError] = useState<string | null>(null)
  const [automaticBackupStatus, setAutomaticBackupStatus] =
    useState<AutomaticBackupStatus | null>(null)
  const [activeSection, setActiveSection] = useState('overview')
  const [ocr, setOcr] = useState<OcrUiState>({
    status: 'idle',
    message: '上传支付截图或购物小票，高置信度支出会自动入账，其余先请你确认。',
    progress: 0,
    rawText: '',
  })
  const [ocrBatch, setOcrBatch] = useState<BatchCandidate[]>([])
  const [recentlyDeleted, setRecentlyDeleted] = useState<Expense[]>([])
  const galleryInputRef = useRef<HTMLInputElement>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const expensesRef = useRef(expenses)
  const backupStateRef = useRef({ expenses, settings })
  const pendingOcrTextRef = useRef<string | null>(null)
  const ocrRequestIdRef = useRef(0)
  const ocrBusyRef = useRef(false)
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const previousTodayRef = useRef(today)
  expensesRef.current = expenses
  const [automaticBackup] = useState(() =>
    createAutomaticBackupController(
      () => backupStateRef.current,
      setAutomaticBackupStatus,
    ),
  )

  useEffect(() => {
    const previousToday = previousTodayRef.current
    if (previousToday === today) return
    setSelectedMonth((current) =>
      current === previousToday.slice(0, 7) ? today.slice(0, 7) : current,
    )
    if (!editingId) {
      setDraft((current) => (current.date === previousToday ? { ...current, date: today } : current))
    }
    previousTodayRef.current = today
  }, [editingId, today])

  useEffect(
    () => () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    },
    [],
  )

  // The bottom bar used to highlight only whatever was last tapped, so it disagreed with the page
  // as soon as the user scrolled by hand. Tracking the topmost visible section keeps the two in
  // step in both directions.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return
    const elements = SECTION_IDS.map((id) => document.getElementById(id)).filter(
      (element): element is HTMLElement => element !== null,
    )
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((first, second) => first.boundingClientRect.top - second.boundingClientRect.top)[0]
        if (visible?.target.id) setActiveSection(visible.target.id)
      },
      // A band near the top of the viewport, so a section counts as current once it reaches
      // reading position rather than the moment its last pixel leaves the screen.
      { rootMargin: '-72px 0px -60% 0px', threshold: 0 },
    )
    elements.forEach((element) => observer.observe(element))
    return () => observer.disconnect()
  }, [])

  const categories = useMemo(
    () => availableCategories(settings.customCategories, expenses),
    [expenses, settings.customCategories],
  )
  const persistExpenses = (nextExpenses: Expense[]) => {
    expensesRef.current = nextExpenses
    backupStateRef.current = { ...backupStateRef.current, expenses: nextExpenses }
    setExpenses(nextExpenses)
    setStorageError(
      saveExpenses(nextExpenses)
        ? null
        : '账单保存失败：本地存储空间可能已满。请立即导出已有备份。',
    )
    automaticBackup.recordChange()
  }

  const persistSettings = (nextSettings: AppSettings) => {
    backupStateRef.current = { ...backupStateRef.current, settings: nextSettings }
    setSettings(nextSettings)
    setStorageError(saveSettings(nextSettings) ? null : '设置保存失败：本地存储空间可能已满。')
    automaticBackup.recordChange()
  }

  useEffect(() => {
    if (!shouldRestoreSnapshot || !Capacitor.isNativePlatform()) {
      setBackupReady(true)
      return
    }

    let cancelled = false
    void readAutomaticBackup()
      .then((snapshot) => {
        if (cancelled || !snapshot) return
        const currentPresence = getStoredAppDataPresence()
        if (currentPresence.expenses && currentPresence.settings) return
        const snapshotExpenses = snapshot.expenses
          .map(sanitizeExpense)
          .filter((expense): expense is Expense => expense !== null)
        const currentExpenses = backupStateRef.current.expenses
        const recoveredExpenses = currentPresence.expenses
          ? []
          : mergeImportedExpenses(snapshotExpenses, currentExpenses).added
        const restoredExpenses = currentPresence.expenses
          ? currentExpenses
          : [...currentExpenses, ...recoveredExpenses]
        const restoredSettings =
          currentPresence.settings || !snapshot.settings
            ? backupStateRef.current.settings
            : snapshot.settings
        const expensesSaved = currentPresence.expenses || saveExpenses(restoredExpenses)
        const settingsSaved =
          currentPresence.settings || !snapshot.settings || saveSettings(restoredSettings)
        if (!currentPresence.expenses) {
          expensesRef.current = restoredExpenses
          setExpenses(restoredExpenses)
        }
        if (!currentPresence.settings && snapshot.settings) setSettings(restoredSettings)
        backupStateRef.current = {
          expenses: restoredExpenses,
          settings: restoredSettings,
        }
        setStorageError(
          expensesSaved && settingsSaved
            ? null
            : '系统备份已找到，但恢复到本地存储失败。请立即导出 JSON 备份。',
        )
        if (!currentPresence.expenses && recoveredExpenses.length > 0) {
          setOcr((current) => ({
            ...current,
            message: `已从应用私有备份恢复 ${recoveredExpenses.length} 笔记录。`,
          }))
        }
      })
      .finally(() => {
        if (!cancelled) setBackupReady(true)
      })

    return () => {
      cancelled = true
    }
  }, [shouldRestoreSnapshot])

  useEffect(() => {
    if (!backupReady) return
    let cancelled = false
    void automaticBackup
      .start()
      .then(() => {
        // Existing installs already have authoritative local data, so verify the new shared mirror
        // immediately. A fresh/reinstalled app must not overwrite an older shared backup with an
        // empty snapshot before the user has had a chance to import it.
        if (!cancelled && !shouldRestoreSnapshot) return automaticBackup.flush()
      })
      .catch(() => {
        if (!cancelled) setAutomaticBackupStatus({ state: 'failed' })
      })
    return () => {
      cancelled = true
      automaticBackup.stop()
    }
  }, [automaticBackup, backupReady, shouldRestoreSnapshot])

  // 首启动后把默认设置落盘，getStoredAppDataPresence 才能把"用过这个应用"和"本地数据被清空"
  // 区分开。必须等恢复流程结束，否则会抢在快照之前把 settings 写成默认值。
  useEffect(() => {
    if (!backupReady || getStoredAppDataPresence().settings) return
    saveSettings(backupStateRef.current.settings)
  }, [backupReady])

  const resetDraft = () => {
    setEditingId(null)
    setDraft(defaultDraft(today))
    setFormError(null)
  }

  const handleDraftChange = (key: keyof Draft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }))
    if (key === formError?.field) setFormError(null)
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const amount = parseAmountInput(draft.amount)
    if (amount === null || amount <= 0) {
      setFormError({
        field: 'amount',
        message: '请输入大于 0 的有效金额，例如 12.50 或 1,234.56。',
      })
      return
    }
    if (!isValidExpenseAmount(amount)) {
      setFormError({
        field: 'amount',
        message: `单笔金额不能超过 ${moneyFormatter.format(MAX_EXPENSE_AMOUNT)}。`,
      })
      return
    }
    if (!isValidExpenseDate(draft.date) || draft.date > today) {
      setFormError({
        field: 'date',
        message: '请选择有效且不晚于今天的日期。',
      })
      return
    }

    const normalizedDraft = { ...draft, amount: amount.toFixed(2) }
    const recognizedRawText = pendingOcrTextRef.current
    if (editingId) {
      persistExpenses(
        expensesRef.current.map((expense) =>
          expense.id === editingId
            ? {
                ...expense,
                amount,
                category: normalizedDraft.category,
                date: normalizedDraft.date,
                note: normalizedDraft.note.trim(),
                paymentMethod: normalizedDraft.paymentMethod,
              }
            : expense,
        ),
      )
    } else {
      persistExpenses([
        createExpense(
          normalizedDraft,
          recognizedRawText ? 'screenshot' : 'manual',
          recognizedRawText ?? undefined,
        ),
        ...expensesRef.current,
      ])
    }

    pendingOcrTextRef.current = null
    resetDraft()
    if (recognizedRawText) {
      setOcr((current) => ({
        ...current,
        status: 'saved',
        message: `已确认记录 ${moneyFormatter.format(amount)}。`,
      }))
    }
  }

  const startEdit = (expense: Expense) => {
    pendingOcrTextRef.current = null
    setEditingId(expense.id)
    setFormError(null)
    setDraft({
      amount: expense.amount.toFixed(2),
      category: expense.category,
      date: expense.date,
      note: expense.note,
      paymentMethod: expense.paymentMethod,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // Deletions stack instead of replacing each other: a single slot meant that clearing two rows in
  // a row silently made the first one unrecoverable. The window restarts on every delete and drops
  // the whole stack at once, so the toast never outlives what it offers to restore.
  const deleteExpense = (expense: Expense) => {
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current)
    persistExpenses(expensesRef.current.filter((item) => item.id !== expense.id))
    setRecentlyDeleted((current) => [expense, ...current])
    undoTimerRef.current = setTimeout(() => setRecentlyDeleted([]), 5_000)
    if (editingId === expense.id) resetDraft()
  }

  const undoDelete = () => {
    setRecentlyDeleted((current) => {
      const [restored, ...remaining] = current
      if (!restored) return current
      if (!expensesRef.current.some((item) => item.id === restored.id)) {
        persistExpenses([restored, ...expensesRef.current])
      }
      if (remaining.length === 0 && undoTimerRef.current) clearTimeout(undoTimerRef.current)
      return remaining
    })
  }

  const applyOcrDocument = (document: OcrDocument, requestId: number) => {
    if (requestId !== ocrRequestIdRef.current) return
    const parsed = parseOcrDocument(document)
    const decision = decideOcrDocument(document, parsed, expensesRef.current)
    const reviewText = formatOcrReview(document, parsed)
    pendingOcrTextRef.current = document.text
    setEditingId(null)
    setFormError(null)

    if (decision.kind === 'batch') {
      setOcrBatch(
        prepareOcrDocumentBatch([
          { documentIndex: 0, documentText: document.text, transactions: decision.transactions },
        ]),
      )
      setDraft(defaultDraft(today))
      const truncatedMessage = parsed.truncatedTransactionCount
        ? `，另有 ${parsed.truncatedTransactionCount} 笔超过单图上限，请拆分截图继续识别`
        : ''
      setOcr({
        status: 'needs-review',
        message: `识别到 ${decision.transactions.length} 笔候选，请勾选后批量入账${truncatedMessage}。`,
        progress: 1,
        rawText: reviewText,
        engine: document.engine,
        confidence: parsed.documentConfidence,
      })
      return
    }

    setOcrBatch([])
    if (decision.kind === 'empty') {
      setDraft(defaultDraft(today))
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

    const { draft: nextDraft, transaction } = decision
    setDraft(nextDraft)
    if (decision.kind === 'review') {
      setOcr({
        status: 'needs-review',
        message: ocrReviewMessage(decision),
        progress: 1,
        rawText: reviewText,
        engine: document.engine,
        confidence: transaction.confidence,
      })
      return
    }

    persistExpenses([createExpense(nextDraft, 'screenshot', document.text), ...expensesRef.current])
    pendingOcrTextRef.current = null
    setDraft(defaultDraft(today))
    setOcr({
      status: 'saved',
      message: `已用 ${document.engine} 自动记录 ${moneyFormatter.format(decision.amount)}。`,
      progress: 1,
      rawText: reviewText,
      engine: document.engine,
      confidence: transaction.confidence,
    })
  }

  /**
   * Several screenshots always land in the batch panel rather than auto-saving. Auto-entry is only
   * trustworthy when the user is looking at the one image it came from; across a picked set it
   * would commit rows nobody reviewed.
   *
   * Takes recognizers rather than paths so the native picker (URIs) and the web file input (File
   * objects) share one merge-and-review path.
   */
  const applyOcrDocuments = async (
    recognizers: Array<
      (onProgress: (progress: number, message: string) => void) => Promise<OcrDocument>
    >,
    requestId: number,
  ) => {
    const groups: OcrDocumentTransactionGroup[] = []
    let lastEngine: string | undefined
    let truncatedCount = 0
    const reviews: string[] = []

    for (const [index, recognize] of recognizers.entries()) {
      const document = await recognize((progress, message) =>
        updateOcrProgress(
          requestId,
          (index + progress) / recognizers.length,
          `第 ${index + 1}/${recognizers.length} 张：${message}`,
        ),
      )
      if (requestId !== ocrRequestIdRef.current) return
      const parsed = parseOcrDocument(document)
      lastEngine = document.engine
      truncatedCount += parsed.truncatedTransactionCount ?? 0
      reviews.push(`—— 第 ${index + 1} 张 ——`, formatOcrReview(document, parsed))
      groups.push({
        documentIndex: index,
        documentText: document.text,
        transactions: parsed.transactions,
      })
    }

    const collected = prepareOcrDocumentBatch(groups)
    const importableCount = collected.filter((candidate) => candidate.direction === 'expense').length
    const blockedCount = collected.length - importableCount
    const overlapCount = collected.filter((candidate) => candidate.overlapDuplicate).length
    const notices = [
      blockedCount > 0 ? `${blockedCount} 笔非支出不会入账` : '',
      overlapCount > 0 ? `${overlapCount} 笔跨截图重复项已取消勾选` : '',
      truncatedCount > 0 ? `${truncatedCount} 笔超过单图上限，请拆分截图` : '',
    ].filter(Boolean)
    setEditingId(null)
    setFormError(null)
    setDraft(defaultDraft(today))
    pendingOcrTextRef.current = null
    setOcrBatch(collected)
    setOcr({
      status: 'needs-review',
      message:
        collected.length > 0
          ? `${recognizers.length} 张截图共识别到 ${collected.length} 笔候选，请勾选后批量入账${
              notices.length > 0 ? `；${notices.join('，')}` : ''
            }。`
          : `${recognizers.length} 张截图都没有识别到可用金额，请换更清晰、边缘完整的截图。`,
      progress: 1,
      rawText: reviews.join('\n'),
      engine: lastEngine,
    })
  }

  const updateOcrProgress = (requestId: number, progress: number, message: string) => {
    if (requestId !== ocrRequestIdRef.current) return
    setOcr((current) => ({
      ...current,
      status: 'reading',
      progress: Math.max(current.progress, Math.min(0.98, progress)),
      message,
    }))
  }

  const prepareOcr = () => {
    if (ocrBusyRef.current) return null
    ocrBusyRef.current = true
    const requestId = ++ocrRequestIdRef.current
    setOcr({
      status: 'reading',
      message: '正在准备离线识别…',
      progress: 0.05,
      rawText: '',
    })
    setOcrBatch([])
    pendingOcrTextRef.current = null
    return requestId
  }

  const finishOcr = (requestId: number) => {
    if (requestId === ocrRequestIdRef.current) ocrBusyRef.current = false
  }

  const handleNativeCapture = async (source: NativeCaptureSource) => {
    const requestId = prepareOcr()
    if (requestId === null) return
    try {
      const imagePaths = await captureNativeImages(source)
      if (imagePaths.length === 1) {
        const document = await recognizeNativeExpenseImage(imagePaths[0], (progress, message) =>
          updateOcrProgress(requestId, progress, message),
        )
        applyOcrDocument(document, requestId)
      } else {
        await applyOcrDocuments(
          imagePaths.map(
            (imagePath) => (onProgress: (progress: number, message: string) => void) =>
              recognizeNativeExpenseImage(imagePath, onProgress),
          ),
          requestId,
        )
      }
    } catch (error) {
      if (requestId !== ocrRequestIdRef.current) return
      if (isNativeCaptureCancellation(error)) {
        setOcr((current) => ({ ...current, status: 'idle', message: '已取消选择图片。', progress: 0 }))
        return
      }
      if (isNativeCapturePermissionDenied(error)) {
        setOcr({
          status: 'error',
          message: '没有图片访问权限。请到系统设置 → 应用 → 实时记账 → 权限中允许相机或照片访问。',
          progress: 0,
          rawText: '',
        })
        return
      }
      setOcr({
        status: 'error',
        message: error instanceof Error ? error.message : '截图识别失败，请换一张更清晰的截图。',
        progress: 0,
        rawText: '',
      })
    } finally {
      finishOcr(requestId)
    }
  }

  const openImageSource = (source: NativeCaptureSource) => {
    if (ocrBusyRef.current) return
    if (Capacitor.isNativePlatform()) {
      void handleNativeCapture(source)
    } else if (source === 'photos') {
      galleryInputRef.current?.click()
    } else {
      cameraInputRef.current?.click()
    }
  }

  const handleWebImage = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? [])
    if (files.length === 0) return
    if (files.length > MAX_GALLERY_SELECTION) {
      setOcr({
        status: 'error',
        message: `一次最多选择 ${MAX_GALLERY_SELECTION} 张图片，请分批识别。`,
        progress: 0,
        rawText: '',
      })
      event.target.value = ''
      return
    }
    const requestId = prepareOcr()
    if (requestId === null) {
      event.target.value = ''
      return
    }
    try {
      if (files.length === 1) {
        const document = await recognizeExpenseImage(files[0], (progress, message) =>
          updateOcrProgress(requestId, progress, message),
        )
        applyOcrDocument(document, requestId)
      } else {
        await applyOcrDocuments(
          files.map(
            (file) => (onProgress: (progress: number, message: string) => void) =>
              recognizeExpenseImage(file, onProgress),
          ),
          requestId,
        )
      }
    } catch (error) {
      if (requestId !== ocrRequestIdRef.current) return
      setOcr({
        status: 'error',
        message: error instanceof Error ? error.message : '截图识别失败，请换一张更清晰的截图。',
        progress: 0,
        rawText: '',
      })
    } finally {
      finishOcr(requestId)
      event.target.value = ''
    }
  }

  const toggleBatchCandidate = (index: number) => {
    setOcrBatch((current) =>
      current.map((candidate, candidateIndex) =>
        candidateIndex === index && candidate.direction === 'expense'
          ? { ...candidate, selected: !candidate.selected }
          : candidate,
      ),
    )
  }

  const confirmBatchCandidates = () => {
    const selected = ocrBatch.filter(
      (candidate): candidate is BatchCandidate & { amount: number } =>
        candidate.selected && candidate.amount !== null && candidate.direction === 'expense',
    )
    const { added, updatedExpenses, updated } = reconcileOcrBatchExpenses(
      selected,
      expensesRef.current,
    )
    const changed = added.length > 0 || updated > 0
    if (changed) persistExpenses([...added, ...updatedExpenses])
    let resultMessage = '没有新增记录：未勾选项目或所选项目均已存在。'
    if (added.length > 0 && updated > 0) {
      resultMessage = `已新增 ${added.length} 笔支出并修正 ${updated} 笔日期，其余重复项已跳过。`
    } else if (added.length > 0) {
      resultMessage = `已批量记录 ${added.length} 笔支出${added.length < selected.length ? '，重复项已跳过' : ''}。`
    } else if (updated > 0) {
      resultMessage = `已修正 ${updated} 笔截图账单的日期，其余记录未重复添加。`
    }
    setOcrBatch([])
    pendingOcrTextRef.current = null
    setOcr((current) => ({
      ...current,
      status: changed ? 'saved' : 'needs-review',
      message: resultMessage,
    }))
  }

  const dismissBatchCandidates = () => {
    setOcrBatch([])
    pendingOcrTextRef.current = null
    setOcr((current) => ({ ...current, message: '已取消本次批量导入。' }))
  }

  const scrollToSection = (sectionId: string) => {
    setActiveSection(sectionId)
    document.getElementById(sectionId)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <main className="app-shell">
      <header className="topbar" id="overview">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <img src="/favicon.svg" alt="" />
          </span>
          <div>
            <h1>实时记账</h1>
            <p className="eyebrow">{formatHeaderDate(today)}</p>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          title="从相册选择截图"
          aria-label="从相册选择截图"
          disabled={ocr.status === 'reading'}
          onClick={() => openImageSource('photos')}
        >
          <Images size={22} />
        </button>
      </header>

      {storageError ? <div className="storage-alert" role="alert">{storageError}</div> : null}
      {automaticBackupStatus?.state === 'failed' ? (
        <div className="storage-alert" role="alert">
          自动备份失败。请立即手动导出 JSON，确认成功前不要卸载应用。
        </div>
      ) : automaticBackupStatus?.state === 'saved' &&
        !automaticBackupStatus.documentsMirrored ? (
        <div className="storage-alert" role="alert">
          应用私有备份已更新，但 Documents 共享镜像写入或校验失败。卸载前请手动导出 JSON。
        </div>
      ) : null}

      <MonthOverview
        expenses={expenses}
        monthKey={selectedMonth}
        currentMonth={currentMonth}
        today={today}
        monthlyBudget={settings.monthlyBudget}
        onMonthChange={setSelectedMonth}
      />

      <OcrCapturePanel
        ocr={ocr}
        galleryInputRef={galleryInputRef}
        cameraInputRef={cameraInputRef}
        onWebImage={handleWebImage}
        onOpenSource={openImageSource}
      />
      <OcrBatchPanel
        candidates={ocrBatch}
        onToggle={toggleBatchCandidate}
        onCancel={dismissBatchCandidates}
        onConfirm={confirmBatchCandidates}
      />

      <EntryForm
        draft={draft}
        categories={categories}
        editing={editingId !== null}
        reviewing={ocr.status === 'needs-review' && ocrBatch.length === 0}
        maxDate={today}
        error={formError}
        onChange={handleDraftChange}
        onSubmit={handleSubmit}
        onCancel={resetDraft}
      />

      <CategoryStats expenses={expenses} monthKey={selectedMonth} categories={categories} />

      <ExpenseRecords
        expenses={expenses}
        monthKey={selectedMonth}
        categories={categories}
        onEdit={startEdit}
        onDelete={deleteExpense}
      />

      <SettingsPanel settings={settings} onChange={persistSettings} />
      <BackupPanel
        expenses={expenses}
        settings={settings}
        today={today}
        automaticBackupStatus={automaticBackupStatus}
        onExpensesChange={persistExpenses}
        onSettingsChange={persistSettings}
      />

      {ocr.rawText ? (
        <details className="ocr-details">
          <summary>
            <span><ScanText size={17} />查看最近一次识别文本</span>
            <ChevronDown className="details-chevron" size={17} />
          </summary>
          <pre>{ocr.rawText}</pre>
        </details>
      ) : null}

      <nav className="bottom-nav" aria-label="页面快捷导航">
        <button
          className={activeSection === 'overview' ? 'is-active' : undefined}
          type="button"
          aria-current={activeSection === 'overview' ? 'page' : undefined}
          onClick={() => scrollToSection('overview')}
        >
          <BarChart3 size={20} />
          <span>概览</span>
        </button>
        <button
          className={activeSection === 'entry' ? 'is-active' : undefined}
          type="button"
          aria-current={activeSection === 'entry' ? 'page' : undefined}
          onClick={() => scrollToSection('entry')}
        >
          <CirclePlus size={21} />
          <span>记账</span>
        </button>
        <button
          className={activeSection === 'records' ? 'is-active' : undefined}
          type="button"
          aria-current={activeSection === 'records' ? 'page' : undefined}
          onClick={() => scrollToSection('records')}
        >
          <ReceiptText size={20} />
          <span>账单</span>
        </button>
        <button
          className={activeSection === 'settings' ? 'is-active' : undefined}
          type="button"
          aria-current={activeSection === 'settings' ? 'page' : undefined}
          onClick={() => scrollToSection('settings')}
        >
          <Settings2 size={20} />
          <span>设置</span>
        </button>
      </nav>

      {recentlyDeleted.length > 0 ? (
        <div className="undo-toast" role="status" aria-live="polite">
          <span>
            已删除“{recentlyDeleted[0].note || recentlyDeleted[0].category}”
            {recentlyDeleted.length > 1 ? ` 等 ${recentlyDeleted.length} 笔` : ''}
          </span>
          <button type="button" onClick={undoDelete}><RotateCcw size={16} />撤销</button>
        </div>
      ) : null}
    </main>
  )
}

export default App
