import type { AriaAttributes, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn, initialsOf } from '@/lib/utils'

/**
 * The forest-green panel that opens each app's home screen (owner cockpit, the floor, the barber's day, the customer
 * catalogue). The kasi band along the top edge is the brand's signature; everything else on the page stays quiet.
 */
export function HeroPanel({ children, className, as: Tag = 'section', ...rest }: { children: ReactNode; className?: string; as?: 'section' | 'header' | 'div' } & AriaAttributes) {
  return (
    <Tag className={cn('relative overflow-hidden rounded-2xl bg-forest-900 text-white shadow-raised dark:ring-1 dark:ring-white/8', className)} {...rest}>
      <div className="kasi-band h-2.5" aria-hidden />
      <div className="relative px-4 pt-5 pb-5 sm:px-7 sm:pt-7 sm:pb-7">{children}</div>
    </Tag>
  )
}

/** A number with a label on the hero panel. The label always says what the number is; colour is never the only cue. */
export function HeroStat({
  label,
  value,
  icon: Icon,
  tone = 'default',
  hint,
  hideHintOnPhone,
}: {
  label: string
  value: ReactNode
  icon?: LucideIcon
  tone?: 'default' | 'attention' | 'good'
  hint?: ReactNode
  /** For hints that only add context (never for disclaimers): hidden on phones to keep the panel short. */
  hideHintOnPhone?: boolean
}) {
  return (
    <div
      className={cn(
        'flex min-w-0 flex-col rounded-xl border px-3.5 py-3',
        tone === 'attention' ? 'border-ochre/70 bg-ochre/15' : tone === 'good' ? 'border-emerald-brand/40 bg-emerald-brand/10' : 'border-white/12 bg-white/6',
      )}
    >
      <span className="flex items-center gap-1.5 text-[13px] font-medium text-cream">
        {Icon && <Icon className={cn('size-4 shrink-0', tone === 'attention' ? 'text-[#f2c36b]' : 'text-emerald-brand')} aria-hidden />}
        <span className="truncate">{label}</span>
      </span>
      <span className="mt-1 font-display text-[1.75rem] leading-none font-bold text-white tabular sm:text-[2rem]">{value}</span>
      {hint && <span className={cn('mt-1.5 text-[12px] leading-snug text-cream/90', hideHintOnPhone && 'hidden sm:block')}>{hint}</span>}
    </div>
  )
}

/** Round initials avatar (no photos of people are invented). */
export function Initials({ name, className }: { name: string; className?: string }) {
  const letters = initialsOf(name)
  return (
    <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full bg-forest-100 font-display text-[15px] font-bold text-heading', className)} aria-hidden>
      {letters || '?'}
    </span>
  )
}
