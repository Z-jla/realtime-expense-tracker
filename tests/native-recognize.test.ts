import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  availability: vi.fn(),
  recognize: vi.fn(),
}))

vi.mock('../src/ocr/native.ts', () => ({
  PaddleOcr: {
    availability: mocks.availability,
    recognize: mocks.recognize,
  },
}))

import { recognizeNativeExpenseImage } from '../src/ocr/recognize.ts'

const nativeResult = {
  engine: 'PP-OCRv6-tiny',
  width: 1080,
  height: 2400,
  lines: [
    {
      text: '付款成功',
      confidence: 0.98,
      polygon: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 30 },
        { x: 0, y: 30 },
      ],
    },
  ],
  totalTimeMs: 1000,
  detectionTimeMs: 300,
  recognitionTimeMs: 500,
  coldLoadTimeMs: 200,
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => vi.useRealTimers())

describe('原生 OCR 调用', () => {
  it('只调用一次 recognize，并在冷启动等待期间持续更新进度', async () => {
    vi.useFakeTimers()
    mocks.recognize.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve(nativeResult), 1500)),
    )
    const updates: Array<{ progress: number; message: string }> = []

    const pending = recognizeNativeExpenseImage('content://payment.png', (progress, message) => {
      updates.push({ progress, message })
    })
    await vi.advanceTimersByTimeAsync(1500)
    const document = await pending

    expect(mocks.availability).not.toHaveBeenCalled()
    expect(mocks.recognize).toHaveBeenCalledOnce()
    expect(updates.some((update) => update.progress > 0.12)).toBe(true)
    expect(updates.at(-1)?.progress).toBe(0.96)
    expect(document).toMatchObject({ engine: 'PP-OCRv6-tiny', width: 1080, height: 2400 })
  })

  it('识别失败时用 availability 换一条可操作的错误提示', async () => {
    mocks.recognize.mockRejectedValue(new Error('recognize failed'))
    mocks.availability.mockResolvedValue({
      available: false,
      engine: 'PP-OCRv6-tiny',
      reason: 'OpenCV 初始化失败',
    })

    await expect(
      recognizeNativeExpenseImage('content://payment.png', () => {}),
    ).rejects.toThrow('OpenCV 初始化失败')
    expect(mocks.availability).toHaveBeenCalledOnce()
  })

  it('引擎本身可用时保留原始识别错误', async () => {
    mocks.recognize.mockRejectedValue(new Error('图片超过 20 MB 限制'))
    mocks.availability.mockResolvedValue({ available: true, engine: 'PP-OCRv6-tiny' })

    await expect(
      recognizeNativeExpenseImage('content://payment.png', () => {}),
    ).rejects.toThrow('图片超过 20 MB 限制')
  })
})
