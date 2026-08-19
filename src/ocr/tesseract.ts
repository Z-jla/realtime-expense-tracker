import type { OcrDocument, OcrLine, OcrProgressCallback } from './types.ts'

const TESSERACT_LOCAL_OPTIONS = {
  workerPath: '/tesseract/worker.min.js',
  corePath: '/tesseract/',
  langPath: '/tesseract/',
  gzip: false,
}

type TesseractWorker = Awaited<ReturnType<typeof import('tesseract.js').createWorker>>
type TesseractBlock = NonNullable<Awaited<ReturnType<TesseractWorker['recognize']>>['data']['blocks']>[number]

let workerPromise: Promise<TesseractWorker> | null = null
let progressListener: OcrProgressCallback | null = null

function getWorker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js')
      .then(async (module) => {
        const worker = await module.createWorker(['chi_sim', 'eng'], undefined, {
          ...TESSERACT_LOCAL_OPTIONS,
          logger: (message) => {
            if (message.status === 'recognizing text') {
              progressListener?.(message.progress, `兼容引擎识别中 ${Math.round(message.progress * 100)}%`)
            }
          },
        })
        await worker.setParameters({
          tessedit_pageseg_mode: module.PSM.SPARSE_TEXT,
          preserve_interword_spaces: '1',
          user_defined_dpi: '300',
        })
        return worker
      })
      .catch((error) => {
        workerPromise = null
        throw error
      })
  }
  return workerPromise
}

function blockLines(blocks: TesseractBlock[]): OcrLine[] {
  return blocks.flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines
        .map((line): OcrLine | null => {
          const text = line.text.replace(/\s+/g, ' ').trim()
          if (!text) return null
          const { x0, y0, x1, y1 } = line.bbox
          return {
            text,
            confidence: Math.max(0, Math.min(1, line.confidence / 100)),
            polygon: [
              { x: x0, y: y0 },
              { x: x1, y: y0 },
              { x: x1, y: y1 },
              { x: x0, y: y1 },
            ],
          }
        })
        .filter((line): line is OcrLine => line !== null),
    ),
  )
}

function textOnlyLines(text: string, width: number, height: number, confidence: number): OcrLine[] {
  const rows = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const rowHeight = height / Math.max(rows.length, 1)

  return rows.map((line, index) => ({
    text: line,
    confidence,
    polygon: [
      { x: 0, y: index * rowHeight },
      { x: width, y: index * rowHeight },
      { x: width, y: (index + 1) * rowHeight },
      { x: 0, y: (index + 1) * rowHeight },
    ],
  }))
}

export async function recognizeWithTesseract(
  blob: Blob,
  width: number,
  height: number,
  onProgress: OcrProgressCallback,
): Promise<OcrDocument> {
  progressListener = onProgress
  const startedAt = performance.now()
  try {
    const worker = await getWorker()
    const result = await worker.recognize(blob, {}, { text: true, blocks: true })
    const confidence = Math.max(0, Math.min(1, result.data.confidence / 100))
    const lines = result.data.blocks
      ? blockLines(result.data.blocks)
      : textOnlyLines(result.data.text, width, height, confidence)
    const text = lines.map((line) => line.text).join('\n') || result.data.text.trim()

    return {
      engine: 'Tesseract.js',
      width,
      height,
      lines,
      text,
      metrics: { totalTimeMs: Math.round(performance.now() - startedAt) },
    }
  } finally {
    progressListener = null
  }
}
