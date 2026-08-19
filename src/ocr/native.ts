import { registerPlugin } from '@capacitor/core'
import type { OcrLine, OcrMetrics } from './types.ts'

type NativeAvailability = {
  available: boolean
  engine: string
}

type NativeRecognitionResult = OcrMetrics & {
  engine: string
  lines: OcrLine[]
}

type PaddleOcrPlugin = {
  availability(): Promise<NativeAvailability>
  recognize(options: { imageBase64: string }): Promise<NativeRecognitionResult>
}

export const PaddleOcr = registerPlugin<PaddleOcrPlugin>('PaddleOcr')
