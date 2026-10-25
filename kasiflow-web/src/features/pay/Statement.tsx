import { ArrowDownLeft, ArrowUpRight, Car, CircleSlash, Footprints, HandCoins, Scale, Scissors, type LucideIcon } from 'lucide-react'
import { AnimatedNumber } from '@/components/shared/AnimatedNumber'
import { balanceWording, type BalanceTone } from '@/lib/earnings'
import { formatDate, formatZAR } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { EarningsDto } from '@/types/pro'

const TONE: Record<BalanceTone, { box: string; icon: LucideIcon; iconBox: string }> = {
  owed: { box: 'border-emerald-200 bg-emerald-50', icon: ArrowDownLeft, iconBox: 'bg-emerald-700 text-white' },
  owes: { box: 'border-amber-300 bg-amber-50', icon: ArrowUpRight, iconBox: 'bg-amber-500 text-forest-950' },
  even: { box: 'border-line bg-surface', icon: Scale, iconBox: 'bg-tint-strong text-heading' },
  unset: { box: 'border-dashed border-line-strong bg-surface', icon: CircleSlash, iconBox: 'bg-tint-strong text-ink-muted' },
}

/** The statement's headline: who owes whom, in words first and the amount big. */
export function BalanceStatement({ e, viewer = 'barber', className }: { e: EarningsDto; viewer?: 'barber' | 'owner'; className?: string }) {
  const w = balanceWording(e, viewer)
  const t = TONE[w.tone]
  return (
    <section aria-label="Balance for this period" className={cn('overflow-hidden rounded-2xl border shadow-card', t.box, className)}>
      <div className="kasi-band h-2" aria-hidden />
      <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:p-6">
        <span className={cn('flex size-14 shrink-0 items-center justify-center rounded-2xl', t.iconBox)} aria-hidden>
          <t.icon className="size-7" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold text-ink-soft">
            {formatDate(e.from)} – {formatDate(e.to)} · {e.terms.modeLabel ?? 'No pay terms yet'}
          </p>
          <p className="mt-1 font-display text-[1.75rem] leading-tight font-bold text-heading sm:text-[2.25rem]">{w.headline}</p>
          <p className="mt-1 text-sm text-ink-soft">{w.detail}</p>
        </div>
        {w.tone !== 'unset' && (
          <p className="shrink-0 text-left sm:text-right">
            <span className="block text-[12px] font-medium text-ink-muted">Earned this period</span>
            <AnimatedNumber value={e.earnedCents} format={formatZAR} className="font-display text-2xl font-bold text-heading tabular" />
          </p>
        )}
      </div>
    </section>
  )
}

function Tile({ label, value, icon: Icon, hint }: { label: string; value: React.ReactNode; icon: LucideIcon; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-line bg-surface p-3.5 shadow-card">
      <dt className="flex items-center gap-1.5 text-[13px] font-medium text-ink-muted">
        <Icon className="size-4 shrink-0 text-forest-800" aria-hidden />
        <span className="truncate">{label}</span>
      </dt>
      <dd className="mt-1 font-display text-[1.4rem] leading-tight font-bold text-heading tabular">{value}</dd>
      {hint && <dd className="mt-0.5 text-[12px] leading-snug text-ink-muted">{hint}</dd>}
    </div>
  )
}

/** Visits, services and how the pay is worked out, as tiles. */
export function StatementBreakdown({ e }: { e: EarningsDto }) {
  const mode = e.terms.mode
  return (
    <dl className="stagger grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
      <Tile label="Visits done" icon={Scissors} value={<AnimatedNumber value={e.visits} />} hint="Completed visits" />
      <Tile label="Walk-ins" icon={Footprints} value={<AnimatedNumber value={e.walkIns} />} hint="From the queue" />
      <Tile label="House calls" icon={Car} value={<AnimatedNumber value={e.houseCalls} />} hint={e.travelFeesCents > 0 ? `${formatZAR(e.travelFeesCents)} travel fees (shop)` : undefined} />
      <Tile label="Services done" icon={HandCoins} value={<AnimatedNumber value={e.servicesCents} format={formatZAR} />} hint="At your prices, after discounts" />
      {mode === 'chair_rent' ? (
        <Tile label="Chair rent" icon={ArrowUpRight} value={formatZAR(e.chairRentCents)} hint={e.terms.chairRentWeeklyCents != null ? `${formatZAR(e.terms.chairRentWeeklyCents)} a week` : undefined} />
      ) : mode === 'wage' ? (
        <Tile label="Wage" icon={ArrowDownLeft} value={formatZAR(e.wageCents)} hint={e.terms.wageWeeklyCents != null ? `${formatZAR(e.terms.wageWeeklyCents)} a week` : undefined} />
      ) : (
        <Tile label="Commission" icon={ArrowDownLeft} value={formatZAR(e.commissionCents)} hint={e.terms.commissionPercent != null ? `${e.terms.commissionPercent}% of services` : 'No terms set'} />
      )}
      <Tile label={e.paidOutCents < 0 ? 'Received' : 'Paid out'} icon={Scale} value={formatZAR(Math.abs(e.paidOutCents))} hint="Recorded by the owner" />
    </dl>
  )
}
