import { cn } from '@/lib/utils'

/** A row of choices where exactly one is on (periods, views). `tone="dark"` for the charcoal hero panels. */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  tone = 'light',
  className,
}: {
  value: T
  options: readonly { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
  tone?: 'light' | 'dark'
  className?: string
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        'inline-flex max-w-full gap-0.5 overflow-x-auto rounded-lg border p-0.5',
        tone === 'dark' ? 'border-white/15 bg-forest-950/40' : 'border-line-strong bg-surface',
        className,
      )}
    >
      {options.map((o) => {
        const on = o.value === value
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-10 shrink-0 cursor-pointer rounded-md px-3.5 text-[13px] font-semibold whitespace-nowrap transition-colors',
              tone === 'dark'
                ? on
                  ? 'bg-emerald-brand text-forest-950'
                  : 'text-cream hover:bg-white/10 hover:text-white'
                : on
                  ? 'bg-primary text-primary-fg'
                  : 'text-ink-soft hover:bg-tint',
            )}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

/** Tappable chips; several can be on (services) or one (payment method, with `single`). */
export function ChoiceChips<T extends string>({
  options,
  selected,
  onToggle,
  label,
  className,
}: {
  options: readonly { value: T; label: string; hint?: string }[]
  selected: readonly T[]
  onToggle: (v: T) => void
  label: string
  className?: string
}) {
  return (
    <div role="group" aria-label={label} className={cn('flex flex-wrap gap-2', className)}>
      {options.map((o) => {
        const on = selected.includes(o.value)
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.value)}
            className={cn(
              'inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-[14px] font-semibold transition-colors',
              on ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong bg-surface text-ink hover:bg-tint',
            )}
          >
            {o.label}
            {o.hint && <span className={cn('text-[12px] font-medium', on ? 'opacity-80' : 'text-ink-muted')}>{o.hint}</span>}
          </button>
        )
      })}
    </div>
  )
}
