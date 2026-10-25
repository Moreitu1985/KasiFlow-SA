import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { applyTheme, readThemePref, resolveTheme, systemPrefersDark, writeThemePref, type Theme, type ThemePref } from '@/lib/theme'

interface ThemeState {
  /** What the person chose: System, Light or Dark. */
  pref: ThemePref
  /** What is showing now. */
  theme: Theme
  setPref: (pref: ThemePref) => void
}

const Ctx = createContext<ThemeState | null>(null)

/** Keeps <html data-theme> in step with the person's choice and, on System, with the phone's setting. */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>(() => readThemePref())
  const [systemDark, setSystemDark] = useState(() => systemPrefersDark())

  useEffect(() => {
    let mq: MediaQueryList | null = null
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)')
    } catch {
      return
    }
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches)
    mq.addEventListener?.('change', on)
    return () => mq?.removeEventListener?.('change', on)
  }, [])

  const theme = resolveTheme(pref, systemDark)
  useEffect(() => applyTheme(theme), [theme])

  const setPref = useCallback((p: ThemePref) => {
    writeThemePref(p)
    setPrefState(p)
  }, [])

  const value = useMemo(() => ({ pref, theme, setPref }), [pref, theme, setPref])
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useTheme(): ThemeState {
  const v = useContext(Ctx)
  if (!v) throw new Error('useTheme must be used inside ThemeProvider')
  return v
}
