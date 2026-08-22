import {
  DEFAULT_SETTINGS,
  sanitizeExpense,
  sanitizeSettings,
  type AppSettings,
  type Expense,
} from './expenses.ts'

export const EXPENSES_STORAGE_KEY = 'spend-app-expenses-v1'
export const SETTINGS_STORAGE_KEY = 'spend-app-settings-v1'

export type StorageLike = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadExpenses(storage: StorageLike | null = browserStorage()): Expense[] {
  if (!storage) return []
  try {
    const stored = storage.getItem(EXPENSES_STORAGE_KEY)
    if (!stored) return []
    const parsed = JSON.parse(stored)
    if (!Array.isArray(parsed)) return []
    return parsed.map(sanitizeExpense).filter((item): item is Expense => item !== null)
  } catch {
    return []
  }
}

export function saveExpenses(expenses: Expense[], storage: StorageLike | null = browserStorage()) {
  if (!storage) return false
  try {
    storage.setItem(EXPENSES_STORAGE_KEY, JSON.stringify(expenses))
    return true
  } catch {
    return false
  }
}

export function loadSettings(storage: StorageLike | null = browserStorage()): AppSettings {
  if (!storage) return { ...DEFAULT_SETTINGS }
  try {
    const stored = storage.getItem(SETTINGS_STORAGE_KEY)
    return stored ? sanitizeSettings(JSON.parse(stored)) : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings: AppSettings, storage: StorageLike | null = browserStorage()) {
  if (!storage) return false
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
    return true
  } catch {
    return false
  }
}

export function getStoredAppDataPresence(storage: StorageLike | null = browserStorage()) {
  const missing = { expenses: false, settings: false }
  if (!storage) return missing

  let expenses = false
  let settings = false
  try {
    const rawExpenses = storage.getItem(EXPENSES_STORAGE_KEY)
    expenses = rawExpenses !== null && Array.isArray(JSON.parse(rawExpenses))
  } catch {
    expenses = false
  }
  try {
    const rawSettings = storage.getItem(SETTINGS_STORAGE_KEY)
    if (rawSettings !== null) {
      const parsed = JSON.parse(rawSettings)
      settings = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    }
  } catch {
    settings = false
  }
  return { expenses, settings }
}
