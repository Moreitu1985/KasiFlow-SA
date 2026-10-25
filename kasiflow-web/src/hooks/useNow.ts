import { useEffect, useState } from 'react'

/** The current time, refreshed every `ms` while mounted (for "in the chair 12 min" style timers). */
export function useNow(ms = 30_000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), ms)
    return () => window.clearInterval(t)
  }, [ms])
  return now
}
