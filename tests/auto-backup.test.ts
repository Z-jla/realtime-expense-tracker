import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, Expense } from '../src/expenses.ts'

const mocks = vi.hoisted(() => ({
  native: true,
  pause: null as null | (() => void),
  addListener: vi.fn(),
  removeListener: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  rename: vi.fn(),
}))

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => mocks.native },
}))

vi.mock('@capacitor/app', () => ({
  App: { addListener: mocks.addListener },
}))

vi.mock('@capacitor/filesystem', () => ({
  Directory: { Data: 'DATA' },
  Encoding: { UTF8: 'utf8' },
  Filesystem: { writeFile: mocks.writeFile, readFile: mocks.readFile, rename: mocks.rename },
}))

import {
  createAutomaticBackupController,
  readAutomaticBackup,
  writeAutomaticBackup,
} from '../src/autoBackup.ts'

const settings: AppSettings = { monthlyBudget: 3000, customCategories: [] }
const firstExpense: Expense = {
  id: 'expense-1',
  amount: 12.5,
  category: '餐饮',
  date: '2026-08-22',
  note: '午饭',
  paymentMethod: '微信',
  source: 'manual',
  createdAt: '2026-08-22T04:00:00.000Z',
}

function backupDocument(expenses: Expense[]) {
  return JSON.stringify({
    app: 'spend-app',
    version: 2,
    exportedAt: '2026-08-22T05:00:00.000Z',
    expenses,
    settings,
  })
}

beforeEach(() => {
  mocks.native = true
  mocks.pause = null
  vi.clearAllMocks()
  mocks.removeListener.mockResolvedValue(undefined)
  mocks.writeFile.mockResolvedValue({ uri: 'file://backups/latest.json.tmp' })
  mocks.rename.mockResolvedValue(undefined)
  mocks.addListener.mockImplementation((_event, callback: () => void) => {
    mocks.pause = callback
    return Promise.resolve({ remove: mocks.removeListener })
  })
})

describe('Android 自动快照', () => {
  it('每五次变化写入一次，并在应用进入后台时立即刷新', async () => {
    let snapshot = { expenses: [firstExpense], settings }
    const controller = createAutomaticBackupController(() => snapshot)
    await controller.start()

    for (let index = 0; index < 4; index += 1) controller.recordChange()
    await Promise.resolve()
    expect(mocks.writeFile).not.toHaveBeenCalled()

    controller.recordChange()
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalledTimes(1))

    snapshot = { expenses: [], settings }
    mocks.pause?.()
    await vi.waitFor(() => expect(mocks.writeFile).toHaveBeenCalledTimes(2))
    const latestPayload = JSON.parse(mocks.writeFile.mock.calls[1][0].data)
    expect(latestPayload.expenses).toEqual([])

    controller.stop()
    expect(mocks.removeListener).toHaveBeenCalledOnce()
  })

  it('先写临时文件再改名，避免写到一半被杀留下截断的快照', async () => {
    await writeAutomaticBackup([firstExpense], settings)

    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.objectContaining({ path: 'backups/latest.json.tmp', directory: 'DATA' }),
    )
    expect(mocks.rename.mock.calls.map((call) => [call[0].from, call[0].to])).toEqual([
      ['backups/latest.json', 'backups/previous.json'],
      ['backups/latest.json.tmp', 'backups/latest.json'],
    ])
  })

  it('第一次写入时没有上一份快照也不会失败', async () => {
    mocks.rename.mockRejectedValueOnce(
      Object.assign(new Error('File does not exist'), { code: 'OS-PLUG-FILE-0008' }),
    )
    await expect(writeAutomaticBackup([firstExpense], settings)).resolves.toBe(true)
    expect(mocks.rename).toHaveBeenCalledTimes(2)
  })

  it('轮转遇到真实文件系统错误时不会误报备份成功', async () => {
    mocks.rename.mockRejectedValueOnce(
      Object.assign(new Error('Permission denied'), { code: 'OS-PLUG-FILE-0007' }),
    )
    await expect(writeAutomaticBackup([firstExpense], settings)).rejects.toThrow('Permission denied')
    expect(mocks.rename).toHaveBeenCalledTimes(1)
  })

  it('可以读取系统恢复后的私有快照', async () => {
    mocks.readFile.mockResolvedValue({ data: backupDocument([firstExpense]) })

    const restored = await readAutomaticBackup()
    expect(restored?.expenses).toEqual([firstExpense])
    expect(restored?.settings).toEqual(settings)
  })

  it('最新快照损坏时回退到上一份', async () => {
    mocks.readFile
      .mockResolvedValueOnce({ data: '{"app":"spend-app","expen' })
      .mockResolvedValueOnce({ data: backupDocument([firstExpense]) })

    const restored = await readAutomaticBackup()
    expect(restored?.expenses).toEqual([firstExpense])
    expect(mocks.readFile.mock.calls.map((call) => call[0].path)).toEqual([
      'backups/latest.json',
      'backups/previous.json',
    ])
  })
})
