import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { InfoTip } from './InfoTip'

export function KpiCard({
  label,
  value,
  definition,
  note,
  tone = 'default',
  to,
  className,
}: {
  label: string
  value: ReactNode
  definition: ReactNode
  note?: ReactNode
  tone?: 'default' | 'warning' | 'critical' | 'positive'
  to?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'relative flex min-w-0 flex-col rounded-lg border border-line bg-surface p-3.5 shadow-card sm:p-5',
        tone === 'critical' && 'border-l-4 border-l-red-600',
        tone === 'warning' && 'border-l-4 border-l-amber-500',
        className,
      )}
    >
      <div className="flex items-center gap-1">
        <p className="text-[13px] font-medium text-ink-muted">{label}</p>
        <InfoTip label={label}>{definition}</InfoTip>
      </div>
      <p className="mt-1.5 font-display text-[1.3rem] leading-tight sm:text-[1.6rem] break-words font-semibold text-ink tabular">{value}</p>
      {note && <div className="mt-1.5 text-[13px] leading-snug text-ink-muted">{note}</div>}
      {to && (
        <Link to={to} className="mt-auto pt-2 text-[13px] font-semibold text-forest-800 hover:underline">
          View details
        </Link>
      )}
    </div>
  )
}
