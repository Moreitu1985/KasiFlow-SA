import { Link } from 'react-router-dom'
import { AlertOctagon, AlertTriangle, ShieldCheck } from 'lucide-react'
import { Money } from '@/components/shared/Money'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { ForecastDto } from '@/types/api'

/** One-sentence verdict on the cash forecast, with the three numbers that back it. */
export function HeadlineRisk({ f }: { f: ForecastDto }) {
  const level = f.firstShortageDate ? 'critical' : f.firstBelowBufferDate || f.firstConservativeShortageDate ? 'warning' : 'ok'
  const Icon = level === 'critical' ? AlertOctagon : level === 'warning' ? AlertTriangle : ShieldCheck

  const headline =
    level === 'critical'
      ? `Your cash could run out on ${formatDate(f.firstShortageDate)}`
      : f.firstBelowBufferDate
        ? `Cash may drop below your safety buffer on ${formatDate(f.firstBelowBufferDate)}`
        : f.firstConservativeShortageDate
          ? `If customers don't pay, cash could run out on ${formatDate(f.firstConservativeShortageDate)}`
          : `No cash shortage expected in the next ${f.horizonDays} days`

  const sub =
    level === 'critical'
      ? 'Based on your recorded balance, planned transactions, bills and the debts customers are expected to pay.'
      : level === 'warning'
        ? 'Not a shortage yet, but close enough to plan ahead. The steps below show what is driving it.'
        : 'Based on what is recorded today. Keep recording sales, expenses and bills so this stays accurate.'

  return (
    <section
      aria-labelledby="risk-headline"
      className={cn(
        'overflow-hidden rounded-lg border bg-surface shadow-card',
        level === 'critical' ? 'border-red-300' : level === 'warning' ? 'border-amber-300' : 'border-line',
      )}
    >
      <div
        className={cn(
          'flex items-start gap-3 px-5 py-5 sm:px-6',
          level === 'critical' ? 'bg-red-50' : level === 'warning' ? 'bg-amber-50' : 'bg-forest-50',
        )}
      >
        <Icon
          className={cn('mt-1 size-6 shrink-0', level === 'critical' ? 'text-red-700' : level === 'warning' ? 'text-amber-700' : 'text-forest-800')}
          aria-hidden
        />
        <div>
          <h2 id="risk-headline" className="text-xl leading-snug font-bold sm:text-2xl">
            {headline}
          </h2>
          <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">{sub}</p>
        </div>
      </div>
      <dl className="grid divide-line sm:grid-cols-3 sm:divide-x max-sm:divide-y">
        <div className="px-5 py-4 sm:px-6">
          <dt className="text-[13px] text-ink-muted">Lowest expected balance</dt>
          <dd className="mt-0.5 font-display text-xl font-semibold">
            <Money cents={f.lowestExpected.balanceCents} tone="auto" />
          </dd>
          <dd className="text-[13px] text-ink-muted">on {formatDate(f.lowestExpected.date)}</dd>
        </div>
        <div className="px-5 py-4 sm:px-6">
          <dt className="text-[13px] text-ink-muted">Lowest if no debts are collected</dt>
          <dd className="mt-0.5 font-display text-xl font-semibold">
            <Money cents={f.lowestConservative.balanceCents} tone="auto" />
          </dd>
          <dd className="text-[13px] text-ink-muted">on {formatDate(f.lowestConservative.date)}</dd>
        </div>
        <div className="px-5 py-4 sm:px-6">
          <dt className="text-[13px] text-ink-muted">Your safety buffer</dt>
          <dd className="mt-0.5 font-display text-xl font-semibold">
            <Money cents={f.cashBufferCents} />
          </dd>
          <dd className="text-[13px] text-ink-muted">
            {f.cashBufferCents > 0 ? (
              'Minimum cash you want to keep'
            ) : (
              <Link to="/settings" className="font-medium text-forest-800 hover:underline">
                Set a buffer in Settings
              </Link>
            )}
          </dd>
        </div>
      </dl>
    </section>
  )
}
