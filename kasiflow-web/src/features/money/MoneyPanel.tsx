import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Info, Wallet } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { KpiCard } from '@/components/shared/KpiCard'
import { Money } from '@/components/shared/Money'
import { CardsSkeleton, ErrorState } from '@/components/shared/States'
import { formatDate } from '@/lib/format'
import { figureTone, MONEY_PERIOD_LABELS, orderFigures } from '@/lib/barbershop'
import { PAYMENT_METHODS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { MoneyPeriod } from '@/types/barbershop'
import { useMoneySummary } from './api'

const LINKS: Record<string, string> = {
  received: '/transactions?type=income',
  expenses: '/expenses',
  pending: '/payments',
  receivables: '/debts',
  bills: '/suppliers',
  unpaid: '/debts',
}

/** "How much did we sell, receive and spend?" — kept as separate figures, with the API's own explanations. */
export function MoneyPanel() {
  const [period, setPeriod] = useState<MoneyPeriod>('day')
  const q = useMoneySummary(period)
  const s = q.data

  return (
    <section aria-labelledby="money-title" className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 id="money-title" className="text-lg font-bold">
            Money {MONEY_PERIOD_LABELS[period].toLowerCase()}
          </h2>
          {s && (
            <p className="text-[13px] text-ink-muted">
              {s.from === s.to ? formatDate(s.from) : `${formatDate(s.from)} to ${formatDate(s.to)}`} · {s.completedBookings} completed{' '}
              {s.completedBookings === 1 ? 'visit' : 'visits'}
              {period === 'day' && ` · ${s.upcomingBookingsToday} still to come today`}
            </p>
          )}
        </div>
        <div className="inline-flex self-start rounded-md border border-line-strong bg-surface p-0.5" role="group" aria-label="Money period">
          {(Object.keys(MONEY_PERIOD_LABELS) as MoneyPeriod[]).map((p) => (
            <button
              key={p}
              type="button"
              aria-pressed={period === p}
              onClick={() => setPeriod(p)}
              className={cn('h-9 cursor-pointer rounded px-3 text-[13px] font-semibold', period === p ? 'bg-primary text-primary-fg' : 'text-ink-soft hover:bg-forest-50')}
            >
              {MONEY_PERIOD_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {q.isLoading ? (
        <CardsSkeleton count={8} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : s ? (
        <div className={cn('space-y-4 transition-opacity', q.isFetching && q.isPlaceholderData && 'opacity-60')}>
          <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
            {orderFigures(s.figures).map((f) => (
              <KpiCard
                key={f.key}
                label={f.label}
                value={<Money cents={f.amountCents} tone={f.key === 'contribution' ? 'auto' : undefined} />}
                definition={f.explanation}
                tone={figureTone(f)}
                to={LINKS[f.key]}
              />
            ))}
          </div>
          <div className="grid min-w-0 grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader className="pb-2">
                <CardTitle className="text-[15px]">Money received by method</CardTitle>
              </CardHeader>
              <CardContent>
                {s.receivedByMethod.length === 0 ? (
                  <p className="text-sm text-ink-muted">No confirmed money in for this period.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {s.receivedByMethod.map((m) => (
                      <li key={m.paymentMethod} className="flex justify-between gap-3 text-sm">
                        <span>{PAYMENT_METHODS[m.paymentMethod] ?? m.paymentMethod}</span>
                        <Money cents={m.amountCents} className="font-semibold" />
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>
            <Card className="min-w-0">
              <CardHeader className="pb-2">
                <CardTitle className="flex items-center gap-2 text-[15px]">
                  <Wallet className="size-4 text-forest-800" aria-hidden /> Available cash
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5">
                <p className="font-display text-2xl font-semibold tabular">{s.availableCashCents == null ? 'Not set up' : <Money cents={s.availableCashCents} />}</p>
                {s.availableCashNote && <p className="text-[13px] leading-snug text-ink-muted">{s.availableCashNote}</p>}
                {s.availableCashCents == null && (
                  <Link to="/settings" className="text-[13px] font-semibold text-forest-800 hover:underline">
                    Set opening balance
                  </Link>
                )}
              </CardContent>
            </Card>
          </div>
          {s.notes.length > 0 && (
            <ul className="space-y-1.5 rounded-lg border border-line bg-surface p-4">
              {s.notes.map((n) => (
                <li key={n} className="flex gap-2 text-[13px] leading-relaxed text-ink-soft">
                  <Info className="mt-0.5 size-4 shrink-0 text-sky-700" aria-hidden />
                  {n}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}
