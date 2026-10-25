import type { ReactNode } from 'react'

export const CHART = {
  income: '#0f8a63',
  expense: '#c2850c',
  expected: '#0f8a63',
  conservative: '#c2850c',
  optimistic: '#6ee7b7',
  buffer: 'var(--color-ink-muted)',
  grid: 'var(--color-line)',
  axis: 'var(--color-ink-muted)',
  /** Labels that need more contrast than axis ticks. */
  label: 'var(--color-ink-soft)',
  /** Ring around active dots: the card colour, so it works in both themes. */
  ring: 'var(--color-surface)',
  zero: 'var(--color-line-strong)',
  cursor: 'color-mix(in srgb, var(--color-ink) 6%, transparent)',
  brass: '#d4a64a',
  shortage: '#b91c1c',
}

export function LegendItem({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft">
      <svg width="18" height="10" aria-hidden>
        <line x1="1" y1="5" x2="17" y2="5" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? '4 3' : undefined} strokeLinecap="round" />
      </svg>
      {label}
    </span>
  )
}

export function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft">
      <span className="size-2.5 rounded-sm" style={{ background: color }} aria-hidden />
      {label}
    </span>
  )
}

export function TooltipBox({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <div className="min-w-44 rounded-md border border-line bg-surface px-3 py-2 text-[13px] shadow-raised">
      <p className="mb-1 font-semibold text-ink">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  )
}

export function TooltipRow({ color, label, value, dashed }: { color: string; label: string; value: string; dashed?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="inline-flex items-center gap-1.5 text-ink-soft">
        <svg width="12" height="8" aria-hidden>
          <line x1="1" y1="4" x2="11" y2="4" stroke={color} strokeWidth="2.5" strokeDasharray={dashed ? '3 2' : undefined} />
        </svg>
        {label}
      </span>
      <span className="font-semibold text-ink tabular">{value}</span>
    </div>
  )
}
