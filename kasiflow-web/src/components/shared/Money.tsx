import { formatZAR } from '@/lib/format'
import { cn } from '@/lib/utils'

export function Money({
  cents,
  className,
  signed,
  tone,
}: {
  cents: number | null | undefined
  className?: string
  /** Prefix positive values with "+" (for income rows). */
  signed?: boolean
  tone?: 'auto' | 'income' | 'expense' | 'muted'
}) {
  const text = formatZAR(cents)
  const color =
    tone === 'income'
      ? 'text-emerald-800'
      : tone === 'expense'
        ? 'text-ink'
        : tone === 'muted'
          ? 'text-ink-muted'
          : tone === 'auto' && typeof cents === 'number' && cents < 0
            ? 'text-red-700'
            : ''
  return <span className={cn('tabular whitespace-nowrap', color, className)}>{signed && typeof cents === 'number' && cents > 0 ? `+${text}` : text}</span>
}
