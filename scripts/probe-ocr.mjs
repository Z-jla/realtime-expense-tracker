import path from 'node:path'
import tesseract from 'tesseract.js'
import { formatOcrReview, parseOcrDocument } from '../src/ocr/parser.ts'

const { createWorker, PSM } = tesseract
const imagePath = process.argv[2]
const langs = (process.argv[3] ?? 'chi_sim+eng').split('+')

if (!imagePath) {
  console.error('Usage: node scripts/probe-ocr.mjs <image-path> [chi_sim+eng]')
  process.exit(1)
}

function flattenBlocks(blocks) {
  return (blocks ?? []).flatMap((block) =>
    block.paragraphs.flatMap((paragraph) =>
      paragraph.lines.map((line) => ({
        text: line.text.replace(/\s+/g, ' ').trim(),
        confidence: Math.max(0, Math.min(1, line.confidence / 100)),
        polygon: [
          { x: line.bbox.x0, y: line.bbox.y0 },
          { x: line.bbox.x1, y: line.bbox.y0 },
          { x: line.bbox.x1, y: line.bbox.y1 },
          { x: line.bbox.x0, y: line.bbox.y1 },
        ],
      })),
    ),
  )
}

const worker = await createWorker(langs, undefined, {
  langPath: path.resolve('public/tesseract'),
  gzip: false,
  logger: (message) => {
    if (message.status === 'recognizing text') {
      process.stderr.write(`OCR ${Math.round(message.progress * 100)}%\r`)
    }
  },
})

try {
  await worker.setParameters({
    tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    preserve_interword_spaces: '1',
    user_defined_dpi: '300',
  })
  const startedAt = performance.now()
  const result = await worker.recognize(imagePath, {}, { text: true, blocks: true })
  const lines = flattenBlocks(result.data.blocks).filter((line) => line.text)
  const width = Math.max(1, ...lines.flatMap((line) => line.polygon.map((point) => point.x)))
  const height = Math.max(1, ...lines.flatMap((line) => line.polygon.map((point) => point.y)))
  const document = {
    engine: 'Tesseract.js',
    width,
    height,
    lines,
    text: lines.map((line) => line.text).join('\n') || result.data.text.trim(),
    metrics: { totalTimeMs: Math.round(performance.now() - startedAt) },
  }
  const parsed = parseOcrDocument(document)

  console.log('\n--- OCR REVIEW ---')
  console.log(formatOcrReview(document, parsed))
  console.log('--- STRUCTURED RESULT ---')
  console.log(JSON.stringify(parsed, null, 2))
} finally {
  await worker.terminate()
}
