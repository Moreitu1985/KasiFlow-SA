/**
 * "Night shift" theme: System (follows the phone), Light or Dark. The choice is remembered on this device only.
 * The resolved theme is written to <html data-theme="…"> so the CSS tokens in index.css switch everywhere at once.
 */
import { readStorage, writeStorage } from './storage'

export type ThemePref = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

export const THEME_KEY = 'kf-theme'

/** Browser/phone chrome colour per theme (matches the page background). */
export const THEME_COLOR: Record<Theme, string> = { light: '#f8f4ec', dark: '#0e0e11' }

export function parseThemePref(raw: string | null | undefined): ThemePref {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system'
}

export function resolveTheme(pref: ThemePref, systemPrefersDark: boolean): Theme {
  if (pref === 'system') return systemPrefersDark ? 'dark' : 'light'
  return pref
}

export function readThemePref(): ThemePref {
  return parseThemePref(readStorage(THEME_KEY))
}

export function writeThemePref(pref: ThemePref): void {
  writeStorage(THEME_KEY, pref === 'system' ? null : pref)
}

export function systemPrefersDark(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  } catch {
    return false
  }
}

/** Puts the theme on <html> and the browser chrome colour on <meta name="theme-color">. */
export function applyTheme(theme: Theme): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  root.dataset.theme = theme
  root.style.colorScheme = theme
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.setAttribute('content', THEME_COLOR[theme]))
}
