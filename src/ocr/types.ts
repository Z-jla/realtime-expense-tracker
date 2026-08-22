export type OcrPoint = {
  x: number
  y: number
}

export type OcrLine = {
  text: string
  confidence: number
  polygon: [OcrPoint, OcrPoint, OcrPoint, OcrPoint]
}

export type OcrMetrics = {
  totalTimeMs?: number
  detectionTimeMs?: number
  recognitionTimeMs?: number
  coldLoadTimeMs?: number
}

export type OcrDocument = {
  engine: 'PP-OCRv6-tiny' | 'Tesseract.js'
  width: number
  height: number
  lines: OcrLine[]
  text: string
  metrics: OcrMetrics
}

export type TransactionDirection = 'expense' | 'income' | 'refund' | 'unknown'

export type AmountCandidate = {
  value: number
  confidence: number
  text: string
  rowText: string
  rowIndex: number
  reasons: string[]
}

export type ParsedTransaction = {
  amount: number | null
  category: string
  date: string
  note: string
  paymentMethod: string
  direction: TransactionDirection
  confidence: number
  amountCandidate: AmountCandidate | null
  alternatives: AmountCandidate[]
  warnings: string[]
  sourceRow?: string
}

export type ParsedOcrResult = {
  transactions: ParsedTransaction[]
  isBillList: boolean
  documentConfidence: number
}

export type OcrProgressCallback = (progress: number, message: string) => void

export type OcrUiState = {
  status: 'idle' | 'reading' | 'saved' | 'needs-review' | 'error'
  message: string
  progress: number
  rawText: string
  engine?: string
  confidence?: number
}
