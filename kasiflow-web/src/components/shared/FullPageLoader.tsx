import { LogoMark } from './Logo'

export function FullPageLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-4" role="status" aria-live="polite">
      <LogoMark className="size-10 animate-pulse text-forest-900 dark:text-[#2a2a2f]" />
      <p className="text-sm text-ink-muted">{label}…</p>
    </div>
  )
}
