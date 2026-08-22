import { normalizeImage } from './image.ts'
import { PaddleOcr } from './native.ts'
import { recognizeWithTesseract } from './tesseract.ts'
import type { OcrDocument, OcrLine, OcrProgressCallback, OcrPoint } from './types.ts'

function isPoint(value: unknown): value is OcrPoint {
  if (!value || typeof value !== 'object') return false
  const point = value as Record<string, unknown>
  return typeof point.x === 'number' && typeof point.y === 'number'
}

function sanitizeNativeLines(value: unknown): OcrLine[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item): OcrLine[] => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const text = typeof raw.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim() : ''
    const confidence = typeof raw.confidence === 'number' ? raw.confidence : 0
    if (!text || !Array.isArray(raw.polygon) || raw.polygon.length !== 4) return []
    if (!raw.polygon.every(isPoint)) return []
    return [
      {
        text,
        confidence: Math.max(0, Math.min(1, confidence)),
        polygon: raw.polygon as [OcrPoint, OcrPoint, OcrPoint, OcrPoint],
      },
    ]
  })
}

function nativeDocument(result: Awaited<ReturnType<typeof PaddleOcr.recognize>>): OcrDocument {
  const lines = sanitizeNativeLines(result.lines)
  return {
    engine: 'PP-OCRv6-tiny',
    width: Math.max(1, result.width),
    height: Math.max(1, result.height),
    lines,
    text: lines.map((line) => line.text).join('\n'),
    metrics: {
      totalTimeMs: result.totalTimeMs,
      detectionTimeMs: result.detectionTimeMs,
      recognitionTimeMs: result.recognitionTimeMs,
      coldLoadTimeMs: result.coldLoadTimeMs,
    },
  }
}

/**
 * `recognize()` initialises the engine on demand, so the happy path never pays for a second
 * bridge round-trip. On failure `availability()` is the only call that reports *why* the engine
 * is unusable, so it is worth one extra round-trip to turn a raw plugin error into advice.
 */
async function describeNativeFailure(error: unknown): Promise<Error> {
  const fallback =
    error instanceof Error ? error : new Error('PP-OCRv6 识别失败，请换一张更清晰的截图。')
  try {
    const availability = await PaddleOcr.availability()
    if (!availability.available) {
      return new Error(
        `离线识别引擎无法启动（${availability.reason || '原因未知'}）。请重启应用，若仍然失败请重新安装。`,
      )
    }
  } catch {
    // Keep the original recognition error when the diagnostic call itself fails.
  }
  return fallback
}

export async function recognizeNativeExpenseImage(
  imagePath: string,
  onProgress: OcrProgressCallback,
): Promise<OcrDocument> {
  let progress = 0.12
  onProgress(progress, '正在加载 PP-OCRv6，首次识别可能需要几秒…')
  const heartbeat = setInterval(() => {
    progress = Math.min(0.72, progress + 0.08)
    onProgress(
      progress,
      progress < 0.4 ? '正在加载离线模型…' : 'PP-OCRv6 正在检测文字和版面…',
    )
  }, 700)

  let result: Awaited<ReturnType<typeof PaddleOcr.recognize>>
  try {
    // recognize() 内部会按需初始化引擎；避免先调用 availability() 造成两次桥接等待。
    result = await PaddleOcr.recognize({ imagePath })
  } catch (error) {
    throw await describeNativeFailure(error)
  } finally {
    clearInterval(heartbeat)
  }
  onProgress(0.96, '正在解析金额与商户…')
  return nativeDocument(result)
}

export async function recognizeExpenseImage(
  file: File,
  onProgress: OcrProgressCallback,
): Promise<OcrDocument> {
  onProgress(0.05, '正在校正图片方向和尺寸…')
  const image = await normalizeImage(file)
  onProgress(0.18, '图片预处理完成')

  onProgress(0.22, '正在启动兼容识别引擎…')
  return recognizeWithTesseract(image.blob, image.width, image.height, onProgress)
}
