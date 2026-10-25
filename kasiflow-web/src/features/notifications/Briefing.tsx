import { Link } from 'react-router-dom'
import { AlertOctagon, AlertTriangle, ArrowRight, Info, Sun } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Callout } from '@/components/shared/Callout'
import { Money } from '@/components/shared/Money'
import { RoleHeader } from '@/features/access/RoleHeader'
import { ErrorState } from '@/components/shared/States'
import { formatDate } from '@/lib/format'
import { appLink } from '@/lib/automation'
import { cn } from '@/lib/utils'
import { useAccess } from '@/features/access/useAccess'
import type { BriefingDto, BriefingItemDto } from '@/types/automation'
import { useBriefing } from './api'

const SEV = {
  critical: { Icon: AlertOctagon, cls: 'text-red-700', border: 'border-l-red-600', label: 'Critical' },
  warning: { Icon: AlertTriangle, cls: 'text-amber-700', border: 'border-l-amber-500', label: 'Warning' },
  informational: { Icon: Info, cls: 'text-sky-700', border: 'border-l-sky-500', label: 'Info' },
} as const

function ItemRow({ item }: { item: BriefingItemDto }) {
  const s = SEV[item.severity] ?? SEV.informational
  const to = appLink(item.link)
  const body = (
    <>
      <s.Icon className={cn('mt-0.5 size-4 shrink-0', s.cls)} aria-label={s.label} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold">{item.title}</span>
        <span className="block text-[13px] leading-snug text-ink-muted">{item.detail}</span>
      </span>
      {to && <ArrowRight className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />}
    </>
  )
  const cls = cn('flex gap-2.5 rounded-md border border-l-4 border-line bg-surface px-3 py-2.5', s.border)
  return <li>{to ? <Link to={to} className={cn(cls, 'hover:bg-paper')}>{body}</Link> : <div className={cls}>{body}</div>}</li>
}

function Numbers({ b, showMoney }: { b: BriefingDto; showMoney: boolean }) {
  if (!showMoney) return null
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <div>
        <dt className="text-[12px] text-ink-muted">Cash recorded today</dt>
        <dd className="font-display text-lg font-semibold">
          <Money cents={b.cashBalanceCents} tone="auto" />
        </dd>
      </div>
      <div>
        <dt className="text-[12px] text-ink-muted">Yesterday in ({b.yesterdaySalesCount} sales)</dt>
        <dd className="font-display text-lg font-semibold">
          <Money cents={b.yesterdayIncomeCents} />
        </dd>
      </div>
      <div>
        <dt className="text-[12px] text-ink-muted">Yesterday out</dt>
        <dd className="font-display text-lg font-semibold">
          <Money cents={b.yesterdayExpensesCents} />
        </dd>
      </div>
      {b.forecast && (
        <div>
          <dt className="text-[12px] text-ink-muted">Lowest balance, next {b.forecast.horizonDays} days</dt>
          <dd className="font-display text-lg font-semibold">
            <Money cents={b.forecast.lowestExpectedBalanceCents} tone="auto" />
          </dd>
        </div>
      )}
    </dl>
  )
}

function DataNotes({ b }: { b: BriefingDto }) {
  const notes = [...b.dataNotes]
  const reason = b.forecast?.isPreliminary ? b.forecast.preliminaryReason : null
  if (reason && !notes.some((n) => n.includes(reason))) notes.unshift(`Preliminary forecast: ${reason}`)
  if (notes.length === 0) return null
  return (
    <ul className="space-y-1 text-[12px] text-ink-muted">
      {notes.map((n, i) => (
        <li key={i}>· {n}</li>
      ))}
    </ul>
  )
}

/** Compact card at the top of the dashboard. */
export function BriefingCard() {
  const q = useBriefing()
  const { can } = useAccess()
  if (q.isLoading) return <Skeleton className="h-36 w-full" />
  if (q.isError || !q.data) return null
  const b = q.data
  const top = b.items.slice(0, 3)
  return (
    <Card className="min-w-0 border-forest-100 bg-gradient-to-br from-white to-forest-50/60">
      <CardContent className="space-y-4 pt-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sun className="size-5 text-ochre" aria-hidden />
            <h2 className="text-lg font-bold">{b.greeting}</h2>
          </div>
          <Link to="/briefing" className="text-[13px] font-semibold text-forest-800 hover:underline">
            Full briefing ({b.items.length})
          </Link>
        </div>
        <Numbers b={b} showMoney={can('viewBusinessInsights')} />
        {top.length > 0 ? (
          <ul className="space-y-2">
            {top.map((it, i) => (
              <ItemRow key={i} item={it} />
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">Nothing needs your attention right now.</p>
        )}
        <DataNotes b={b} />
      </CardContent>
    </Card>
  )
}

export function BriefingPage() {
  const q = useBriefing()
  const { can } = useAccess()
  const b = q.data
  return (
    <div className="space-y-6">
      <RoleHeader title="Daily briefing" description={b ? `${b.greeting}. Your summary for ${formatDate(b.date)}.` : 'Your summary for today.'} />
      {q.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : b ? (
        <>
          {b.forecast?.isPreliminary && can('viewBusinessInsights') && (
            <Callout tone="warning" title="Preliminary forecast">
              {b.forecast.preliminaryReason ?? 'There is not enough recorded history yet for a reliable forecast.'}
            </Callout>
          )}
          <Card>
            <CardContent className="pt-5">
              <Numbers b={b} showMoney={can('viewBusinessInsights')} />
              {!can('viewBusinessInsights') && <p className="text-sm text-ink-muted">Money totals are only shown to people who can see the business finances.</p>}
            </CardContent>
          </Card>
          <section aria-labelledby="brief-items" className="space-y-3">
            <h2 id="brief-items" className="text-lg font-bold">
              What needs attention
            </h2>
            {b.items.length === 0 ? <p className="text-sm text-ink-muted">Nothing needs your attention right now.</p> : (
              <ul className="space-y-2">
                {b.items.map((it, i) => (
                  <ItemRow key={i} item={it} />
                ))}
              </ul>
            )}
          </section>
          <section aria-labelledby="brief-notes" className="space-y-2">
            <h2 id="brief-notes" className="text-base font-bold">
              About this data
            </h2>
            <DataNotes b={b} />
            {b.dataNotes.length === 0 && !b.forecast?.isPreliminary && <p className="text-[13px] text-ink-muted">Based on what has been recorded in KasiFlow.</p>}
          </section>
        </>
      ) : null}
    </div>
  )
}
