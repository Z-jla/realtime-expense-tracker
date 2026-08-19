import { Capacitor } from '@capacitor/core'
import { blobToDataUrl, normalizeImage } from './image.ts'
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

export async function recognizeExpenseImage(
  file: File,
  onProgress: OcrProgressCallback,
): Promise<OcrDocument> {
  onProgress(0.05, '正在校正图片方向和尺寸…')
  const image = await normalizeImage(file)
  onProgress(0.18, '图片预处理完成')

  if (Capacitor.isNativePlatform()) {
    try {
      const availability = await PaddleOcr.availability()
      if (!availability.available) throw new Error('本机 PP-OCRv6 不可用')
      onProgress(0.3, '正在加载 PP-OCRv6 离线模型…')
      const imageBase64 = await blobToDataUrl(image.blob)
      onProgress(0.42, 'PP-OCRv6 正在检测文字和版面…')
      const result = await PaddleOcr.recognize({ imageBase64 })
      const lines = sanitizeNativeLines(result.lines)
      onProgress(0.96, '正在解析金额与商户…')
      return {
        engine: 'PP-OCRv6-tiny',
        width: image.width,
        height: image.height,
        lines,
        text: lines.map((line) => line.text).join('\n'),
        metrics: {
          totalTimeMs: result.totalTimeMs,
          detectionTimeMs: result.detectionTimeMs,
          recognitionTimeMs: result.recognitionTimeMs,
          coldLoadTimeMs: result.coldLoadTimeMs,
        },
      }
    } catch (nativeError) {
      const reason = nativeError instanceof Error ? nativeError.message : '原生识别引擎异常'
      onProgress(0.2, 'PP-OCRv6 不可用，正在切换兼容引擎…')
      const fallback = await recognizeWithTesseract(image.blob, image.width, image.height, onProgress)
      return { ...fallback, fallbackReason: reason }
    }
  }

  onProgress(0.22, '正在启动兼容识别引擎…')
  return recognizeWithTesseract(image.blob, image.width, image.height, onProgress)
}
