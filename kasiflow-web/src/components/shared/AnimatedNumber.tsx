import { useEffect, useRef, useState } from 'react'

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return true
  }
}

/**
 * A number that counts to its new value (about 0.5 s, ease-out). The final text is always exact; with reduced motion
 * it simply shows the value. Screen readers get the final value only.
 */
export function AnimatedNumber({ value, format = (n) => String(Math.round(n)), className }: { value: number; format?: (n: number) => string; className?: string }) {
  const [shown, setShown] = useState(() => (reducedMotion() ? value : 0))
  const from = useRef(shown)
  useEffect(() => {
    if (reducedMotion() || from.current === value) {
      from.current = value
      setShown(value)
      return
    }
    const start = performance.now()
    const a = from.current
    let raf = 0
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / 520)
      const eased = 1 - Math.pow(1 - t, 3)
      const v = a + (value - a) * eased
      from.current = v
      setShown(t >= 1 ? value : v)
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [value])
  return (
    <span className={className}>
      <span aria-hidden>{format(shown)}</span>
      <span className="sr-only">{format(value)}</span>
    </span>
  )
}
