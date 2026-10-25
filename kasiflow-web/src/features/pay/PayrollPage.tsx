import { useMemo, useState } from 'react'
import { Banknote, Info, Pencil, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AnimatedNumber } from '@/components/shared/AnimatedNumber'
import { Callout } from '@/components/shared/Callout'
import { Initials } from '@/components/shared/HeroPanel'
import { KpiCard } from '@/components/shared/KpiCard'
import { Segmented } from '@/components/shared/Segmented'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { balanceWording, PAY_PERIODS, payPeriodRange, type PayPeriodKey } from '@/lib/earnings'
import { formatDate, formatZAR, todayJhb } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RoleHeader } from '@/features/access/RoleHeader'
import type { EarningsDto } from '@/types/pro'
import { usePayroll } from './api'
import { PayoutDialog, PayTermsDialog } from './PayDialogs'

const BAL_TONE = {
  owed: 'text-emerald-800 bg-emerald-50 border-emerald-200',
  owes: 'text-amber-900 bg-amber-50 border-amber-300',
  even: 'text-ink-soft bg-paper border-line',
  unset: 'text-ink-muted bg-paper border-dashed border-line-strong',
} as const

function BarberCard({ e, onTerms, onPayout }: { e: EarningsDto; onTerms: () => void; onPayout: () => void }) {
  const w = balanceWording(e, 'owner')
  return (
    <li className="lift flex min-w-0 flex-col rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex items-start gap-3 p-4 pb-3">
        <Initials name={e.displayName} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{e.displayName}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
            {e.terms.mode ? <Badge variant="outline">{e.terms.modeLabel}</Badge> : <Badge variant="warning">No pay terms</Badge>}
            {e.terms.mode === 'commission' && e.terms.commissionPercent != null && <span className="text-[12px] text-ink-muted">{e.terms.commissionPercent}%</span>}
            {e.terms.mode === 'chair_rent' && e.terms.chairRentWeeklyCents != null && <span className="text-[12px] text-ink-muted">{formatZAR(e.terms.chairRentWeeklyCents)}/week</span>}
            {e.terms.mode === 'wage' && e.terms.wageWeeklyCents != null && <span className="text-[12px] text-ink-muted">{formatZAR(e.terms.wageWeeklyCents)}/week</span>}
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 border-y border-line px-4 py-3 text-sm sm:grid-cols-4">
        <div>
          <dt className="text-[12px] text-ink-muted">Visits</dt>
          <dd className="font-semibold tabular">
            {e.visits}
            {e.walkIns > 0 && <span className="font-normal text-ink-muted"> · {e.walkIns} walk-in</span>}
          </dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-muted">Services done</dt>
          <dd className="font-semibold tabular">{formatZAR(e.servicesCents)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-muted">{e.terms.mode === 'chair_rent' ? 'Rent due' : 'Earned'}</dt>
          <dd className="font-semibold tabular">{formatZAR(e.terms.mode === 'chair_rent' ? e.chairRentCents : e.earnedCents)}</dd>
        </div>
        <div>
          <dt className="text-[12px] text-ink-muted">{e.paidOutCents < 0 ? 'Received' : 'Paid out'}</dt>
          <dd className="font-semibold tabular">{formatZAR(Math.abs(e.paidOutCents))}</dd>
        </div>
      </dl>
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className={cn('rounded-xl border px-3 py-2.5', BAL_TONE[w.tone])}>
          <p className="font-display text-xl leading-tight font-bold">{w.headline}</p>
          <p className="text-[13px] opacity-90">{w.detail}</p>
        </div>
        {e.terms.mode && <p className="text-[13px] leading-snug text-ink-soft">{e.explanation}</p>}
        <div className="mt-auto flex flex-wrap gap-2 pt-1">
          <Button variant={e.terms.mode ? 'outline' : 'default'} onClick={onTerms}>
            <Pencil /> {e.terms.mode ? 'Pay terms' : 'Set pay terms'}
          </Button>
          {e.terms.mode && (
            <Button variant={e.balanceCents !== 0 ? 'default' : 'outline'} onClick={onPayout}>
              <Banknote /> Record payout
            </Button>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * /payroll — "Barber pay" (owner only): each barber's statement for a period, their pay terms, and payouts the owner
 * records. Statements are to agree on, not payslips; KasiFlow never moves money.
 */
export function PayrollPage() {
  const [period, setPeriod] = useState<PayPeriodKey>('this_week')
  const range = useMemo(() => payPeriodRange(period, todayJhb()), [period])
  const q = usePayroll(range)
  const p = q.data
  const [terms, setTerms] = useState<{ id: string; name: string } | null>(null)
  const [payout, setPayout] = useState<EarningsDto | null>(null)

  return (
    <div className="space-y-6">
      <RoleHeader
        title="Barber pay"
        description="Each barber’s statement from completed visits and their pay terms. Agree it with them, then record the payout you made — KasiFlow never moves money."
        actions={<Segmented label="Period" value={period} options={PAY_PERIODS.map((x) => ({ value: x.key, label: x.label }))} onChange={setPeriod} />}
      />

      {q.isLoading ? (
        <div className="space-y-4" aria-busy aria-label="Loading">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Skeleton className="h-72 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load barber pay" />
      ) : p ? (
        <div className={cn('space-y-6 transition-opacity', q.isPlaceholderData && 'opacity-60')}>
          <p className="text-sm text-ink-soft">
            {formatDate(p.from)} to {formatDate(p.to)}
          </p>
          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <KpiCard label="Services done" value={<AnimatedNumber value={p.totalServicesCents} format={formatZAR} />} definition="Completed visits by all barbers in this period, at their prices, after discounts. Services booked, not cash counted." />
            <KpiCard
              label="Shop owes barbers"
              value={<AnimatedNumber value={p.totalOwedToBarbersCents} format={formatZAR} />}
              tone={p.totalOwedToBarbersCents > 0 ? 'warning' : 'default'}
              definition="The sum of positive balances: what the statements say the shop still owes, after payouts you recorded."
            />
            <KpiCard
              label="Barbers owe the shop"
              value={<AnimatedNumber value={p.totalOwedToShopCents} format={formatZAR} />}
              definition="The sum of negative balances, usually chair rent still to receive."
            />
            <KpiCard label="Barbers" value={<AnimatedNumber value={p.barbers.length} />} definition="Active team profiles. Profiles without pay terms show “No pay terms”." note={`${p.barbers.filter((b) => !b.terms.mode).length} without pay terms`} />
          </div>
          {p.barbers.length === 0 ? (
            <EmptyState icon={Users} title="No barbers yet" description="Register your barbers first; their statements appear here." />
          ) : (
            <ul className="stagger grid gap-4 lg:grid-cols-2">
              {p.barbers.map((e) => (
                <BarberCard key={e.staffId} e={e} onTerms={() => setTerms({ id: e.staffId, name: e.displayName })} onPayout={() => setPayout(e)} />
              ))}
            </ul>
          )}
          <Callout tone="neutral" title="About these statements">
            <p className="inline-flex items-start gap-1.5">
              <Info className="mt-0.5 size-4 shrink-0" aria-hidden /> {p.disclaimer} Payouts you record show up in Transactions (as Wages, or chair rent as income).
            </p>
          </Callout>
        </div>
      ) : null}

      <PayTermsDialog staff={terms} onOpenChange={(o) => !o && setTerms(null)} />
      <PayoutDialog e={payout} onOpenChange={(o) => !o && setPayout(null)} />
    </div>
  )
}

