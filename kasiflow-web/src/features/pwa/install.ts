/**
 * "Install app": the browser's beforeinstallprompt event is caught as early as possible (see main.tsx) and kept here
 * so any button can offer it later. iPhones have no such event: they get a "Share → Add to Home Screen" hint instead.
 */
import { useSyncExternalStore } from 'react'

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
let installed = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

export function listenForInstallPrompt(): void {
  if (typeof window === 'undefined') return
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault()
    deferred = e as BeforeInstallPromptEvent
    emit()
  })
  window.addEventListener('appinstalled', () => {
    installed = true
    deferred = null
    emit()
  })
}

function isStandalone(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
  } catch {
    return false
  }
}

function isIos(): boolean {
  const ua = navigator.userAgent
  return /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1)
}

interface InstallState {
  canInstall: boolean
  showIosHint: boolean
}

let snapshot: InstallState = { canInstall: false, showIosHint: false }
function read(): InstallState {
  const standalone = typeof window !== 'undefined' && isStandalone()
  const next = {
    canInstall: !!deferred && !installed && !standalone,
    showIosHint: !deferred && !installed && !standalone && typeof navigator !== 'undefined' && isIos(),
  }
  if (next.canInstall !== snapshot.canInstall || next.showIosHint !== snapshot.showIosHint) snapshot = next
  return snapshot
}

export function useInstallPrompt(): InstallState & { install: () => Promise<boolean> } {
  const s = useSyncExternalStore(
    (cb) => {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },
    read,
    () => snapshot,
  )
  return {
    ...s,
    install: async () => {
      if (!deferred) return false
      const e = deferred
      deferred = null
      emit()
      await e.prompt()
      const choice = await e.userChoice.catch(() => ({ outcome: 'dismissed' as const }))
      return choice.outcome === 'accepted'
    },
  }
}

/** Registers the offline shell (production builds only; never caches API or sign-in calls — see public/sw.js). */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      /* the app works the same without it */
    })
  })
}
