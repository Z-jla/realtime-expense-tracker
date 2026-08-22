import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  native: false,
  writeFile: vi.fn(),
  requestPermissions: vi.fn(),
  canShare: vi.fn(),
  share: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Documents: 'DOCUMENTS' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: {
    writeFile: mocks.writeFile,
    requestPermissions: mocks.requestPermissions,
  },
}))

vi.mock('@capacitor/share', () => ({
  Share: { canShare: mocks.canShare, share: mocks.share },
}))

import { exportBackup } from '../src/backup.ts'
import type { AppSettings, Expense } from '../src/expenses.ts'

const settings: AppSettings = { monthlyBudget: 3000, customCategories: ['学习'] }
const expenses: Expense[] = [
  {
    id: 'expense-1',
    amount: 12.5,
    category: '餐饮',
    date: '2026-08-22',
    note: '午饭',
    paymentMethod: '微信',
    source: 'manual',
    createdAt: '2026-08-22T04:00:00.000Z',
  },
]

beforeEach(() => {
  mocks.native = false
  vi.clearAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('JSON 备份导出', () => {
  it('Android 写入 Documents 后打开分享面板', async () => {
    mocks.native = true
    mocks.writeFile.mockResolvedValue({ uri: 'content://backups/file.json' })
    mocks.canShare.mockResolvedValue({ value: true })
    mocks.share.mockResolvedValue(undefined)

    const result = await exportBackup(expenses, settings, '2026-08-22')

    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({
        path: '实时记账/记账备份-2026-08-22.json',
        directory: 'DOCUMENTS',
      }),
    )
    expect(mocks.share).toHaveBeenCalledWith(
      expect.objectContaining({ files: ['content://backups/file.json'] }),
    )
    expect(result).toEqual({
      fileName: '记账备份-2026-08-22.json',
      location: 'documents',
      shared: true,
    })
  })

  it('Web 点击下载后延迟释放 Blob URL', async () => {
    vi.useFakeTimers()
    const createObjectUrl = vi.fn(() => 'blob:test-backup')
    const revokeObjectUrl = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: createObjectUrl })
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revokeObjectUrl })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    const result = await exportBackup(expenses, settings, '2026-08-22')

    expect(click).toHaveBeenCalledOnce()
    expect(revokeObjectUrl).not.toHaveBeenCalled()
    await vi.runAllTimersAsync()
    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:test-backup')
    expect(result.location).toBe('download')
  })
})
