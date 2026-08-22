import { useEffect, useRef, useState } from 'react'
import { formatLocalDate } from './expenses.ts'

const millisecondsUntilTomorrow = () => {
  const now = new Date()
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  return Math.max(1_000, tomorrow.getTime() - now.getTime() + 250)
}
export function useToday() {
  const [today, setToday] = useState(() => formatLocalDate())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const refresh = () => {
      setToday(formatLocalDate())
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(refresh, millisecondsUntilTomorrow())
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }

    refresh()
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener('focus', refresh)
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener('focus', refresh)
    }
  }, [])

  return today
}
