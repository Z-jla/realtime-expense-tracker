import { registerPlugin } from '@capacitor/core'
import type { OcrLine, OcrMetrics } from './types.ts'

type NativeAvailability = {
  available: boolean
  engine: string
  reason?: string
}

type NativeRecognitionResult = OcrMetrics & {
  engine: string
  width: number
  height: number
  lines: OcrLine[]
}

type PaddleOcrPlugin = {
  availability(): Promise<NativeAvailability>
  recognize(options: { imagePath: string }): Promise<NativeRecognitionResult>
}

export const PaddleOcr = registerPlugin<PaddleOcrPlugin>('PaddleOcr')
