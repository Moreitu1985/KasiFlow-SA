import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, CalendarRange, Flame, Lightbulb, Scissors, Trophy } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { AnimatedNumber } from '@/components/shared/AnimatedNumber'
import { Initials } from '@/components/shared/HeroPanel'
import { KpiCard } from '@/components/shared/KpiCard'
import { Segmented } from '@/components/shared/Segmented'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { formatDate, formatPercent, formatZAR } from '@/lib/format'
import { heatGrid, heatLevel, hourLabel, HEAT_HOURS } from '@/lib/insights'
import { cn } from '@/lib/utils'
import { RoleHeader } from '@/features/access/RoleHeader'
import type { BarberPerformanceDto, ShopInsightsDto } from '@/types/pro'
import { INSIGHT_DAYS, useShopInsights, type InsightDays } from './api'

const DAY_LABELS: Record<InsightDays, string> = { 30: '30 days', 90: '90 days', 180: '6 months', 365: '12 months' }

/** Brass intensity per step (0 = none). Mixed with the card colour so it works in both themes. */
const LEVEL_BG = [
  'var(--color-tint)',
  'color-mix(in srgb, #d4a64a 22%, var(--color-surface))',
  'color-mix(in srgb, #d4a64a 40%, var(--color-surface))',
  'color-mix(in srgb, #d4a64a 60%, var(--color-surface))',
  'color-mix(in srgb, #d4a64a 80%, var(--color-surface))',
  '#d4a64a',
]

function Heatmap({ i }: { i: ShopInsightsDto }) {
  const g = useMemo(() => heatGrid(i.heatmap), [i.heatmap])
  return (
    <div className="space-y-3">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[19rem] border-separate border-spacing-[3px] text-center">
          <caption className="sr-only">Completed visits by weekday and starting hour, {formatDate(i.from)} to {formatDate(i.to)}</caption>
          <thead>
            <tr>
              <th scope="col" className="w-9">
                <span className="sr-only">Day</span>
              </th>
              {HEAT_HOURS.map((h) => (
                <th key={h} scope="col" className="text-[10px] font-semibold text-ink-muted tabular sm:text-[11px]">
                  <span aria-hidden>{String(h).padStart(2, '0')}</span>
                  <span className="sr-only">{hourLabel(h)}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.rows.map((r) => (
              <tr key={r.weekday}>
                <th scope="row" className="pr-1 text-left text-[12px] font-semibold text-ink-soft">
                  <abbr title={r.long} className="no-underline">
                    {r.short}
                  </abbr>
                </th>
                {r.cells.map((c) => {
                  const lvl = heatLevel(c.visits, g.max)
                  return (
                    <td
                      key={c.hour}
                      title={`${r.long} ${hourLabel(c.hour)}: ${c.visits} ${c.visits === 1 ? 'visit' : 'visits'}`}
                      className={cn('h-8 rounded-[5px] text-[11px] font-bold tabular transition-transform hover:scale-110 sm:h-9 sm:text-[12px]', lvl >= 4 ? 'text-forest-950' : 'text-ink-soft')}
                      style={{ background: LEVEL_BG[lvl] }}
                    >
                      {c.visits > 0 ? c.visits : <span className="sr-only">0</span>}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 text-[12px] text-ink-muted">
        <span className="inline-flex items-center gap-1.5" aria-hidden>
          Quiet
          {LEVEL_BG.map((bg, k) => (
            <span key={k} className="size-3.5 rounded-[3px] border border-line" style={{ background: bg }} />
          ))}
          Busy
        </span>
        <span>
          Numbers are completed visits starting in that hour.
          {g.outside > 0 && ` ${g.outside} more started before 08:00 or after 19:00.`}
        </span>
      </div>
    </div>
  )
}

function TopServices({ i }: { i: ShopInsightsDto }) {
  const max = Math.max(1, ...i.topServices.map((s) => s.count))
  if (i.topServices.length === 0) return <p className="text-sm text-ink-muted">No completed services in this period.</p>
  return (
    <ol className="stagger space-y-3">
      {i.topServices.map((s, k) => (
        <li key={s.name}>
          <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate font-semibold">
              <span className="mr-1.5 text-ink-muted tabular">{k + 1}.</span>
              {s.name}
            </span>
            <span className="shrink-0 text-ink-soft tabular">
              {s.count} · {formatZAR(s.revenueCents)}
            </span>
          </div>
          <div className="h-2.5 overflow-hidden rounded-full bg-tint" aria-hidden>
            <div className="h-full rounded-full bg-emerald-brand transition-[width] duration-700" style={{ width: `${Math.max(3, (s.count / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ol>
  )
}

type SortKey = 'visits' | 'revenueCents' | 'averageTicketCents' | 'noShowRate' | 'repeatCustomerRate'
const COLS: { key: SortKey; label: string; fmt: (b: BarberPerformanceDto) => string }[] = [
  { key: 'visits', label: 'Visits', fmt: (b) => String(b.visits) },
  { key: 'revenueCents', label: 'Services', fmt: (b) => formatZAR(b.revenueCents) },
  { key: 'averageTicketCents', label: 'Avg ticket', fmt: (b) => formatZAR(b.averageTicketCents) },
  { key: 'noShowRate', label: 'No-shows', fmt: (b) => `${formatPercent(b.noShowRate)} (${b.noShows})` },
  { key: 'repeatCustomerRate', label: 'Repeat', fmt: (b) => formatPercent(b.repeatCustomerRate) },
]

function Barbers({ list }: { list: BarberPerformanceDto[] }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'revenueCents', desc: true })
  const rows = useMemo(() => [...list].sort((a, b) => (sort.desc ? b[sort.key] - a[sort.key] : a[sort.key] - b[sort.key])), [list, sort])
  if (list.length === 0) return <p className="text-sm text-ink-muted">No barber has completed visits in this period.</p>
  const toggle = (key: SortKey) => setSort((s) => (s.key === key ? { key, desc: !s.desc } : { key, desc: key !== 'noShowRate' }))
  return (
    <>
      {/* Phones: ranked cards */}
      <ol className="stagger space-y-2.5 md:hidden">
        {rows.map((b, k) => (
          <li key={b.staffId} className="rounded-xl border border-line bg-surface p-3">
            <div className="flex items-center gap-3">
              <span className="w-5 text-center font-display font-bold text-ink-muted tabular">{k + 1}</span>
              <Initials name={b.name} className="size-9 text-[13px]" />
              <p className="min-w-0 flex-1 truncate font-semibold">{b.name}</p>
              <p className="font-semibold tabular">{formatZAR(b.revenueCents)}</p>
            </div>
            <dl className="mt-2 grid grid-cols-4 gap-2 pl-8 text-[12px]">
              <div>
                <dt className="text-ink-muted">Visits</dt>
                <dd className="font-semibold tabular">{b.visits}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Avg</dt>
                <dd className="font-semibold tabular">{formatZAR(b.averageTicketCents).replace(/\.00$/, '')}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">No-show</dt>
                <dd className={cn('font-semibold tabular', b.noShowRate >= 10 && 'text-red-700')}>{formatPercent(b.noShowRate)}</dd>
              </div>
              <div>
                <dt className="text-ink-muted">Repeat</dt>
                <dd className="font-semibold tabular">{formatPercent(b.repeatCustomerRate)}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ol>
      {/* Wider: a sortable table */}
      <div className="hidden md:block">
        <table className="w-full text-sm">
          <caption className="sr-only">Barber performance, sortable</caption>
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-ink-muted">
              <th scope="col" className="py-2 pr-3 font-semibold">
                Barber
              </th>
              {COLS.map((c) => (
                <th key={c.key} scope="col" className="py-1 pr-2 text-right font-semibold" aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                  <button type="button" onClick={() => toggle(c.key)} className="inline-flex min-h-9 cursor-pointer items-center gap-1 rounded px-1.5 hover:bg-tint hover:text-ink">
                    {c.label}
                    {sort.key === c.key && (sort.desc ? <ArrowDown className="size-3.5" aria-hidden /> : <ArrowUp className="size-3.5" aria-hidden />)}
                  </button>
                </th>
              ))}
              <th scope="col" className="py-2 text-right font-semibold">
                Walk-in / house
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((b, k) => (
              <tr key={b.staffId} className="border-b border-line last:border-0 hover:bg-tint/60">
                <th scope="row" className="py-2.5 pr-3 text-left font-semibold">
                  <span className="inline-flex items-center gap-2.5">
                    {k === 0 && sort.desc && sort.key === 'revenueCents' ? <Trophy className="size-4 text-ochre" aria-label="Top" /> : <span className="w-4" />}
                    <Initials name={b.name} className="size-8 text-[12px]" />
                    {b.name}
                  </span>
                </th>
                {COLS.map((c) => (
                  <td key={c.key} className={cn('py-2.5 pr-3.5 text-right tabular', c.key === 'noShowRate' && b.noShowRate >= 10 && 'font-semibold text-red-700')}>
                    {c.fmt(b)}
                  </td>
                ))}
                <td className="py-2.5 text-right text-ink-soft tabular">
                  {b.walkIns} / {b.houseCalls}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}

/**
 * /insights — the owner's shop insights: visits, repeat customers, walk-ins and house calls, the busy hours and each
 * barber's numbers. Money here is services booked on completed visits — not cash counted.
 */
export function InsightsPage() {
  const [days, setDays] = useState<InsightDays>(90)
  const q = useShopInsights(days)
  const i = q.data

  return (
    <div className="space-y-6">
      <RoleHeader
        title="Shop insights"
        description="Who comes, when it gets busy and how each barber is doing — from completed visits. Money here is services booked, not cash counted."
        actions={<Segmented label="Period" value={days} options={INSIGHT_DAYS.map((d) => ({ value: d, label: DAY_LABELS[d] }))} onChange={setDays} />}
      />

      {q.isLoading ? (
        <div className="space-y-4" aria-busy aria-label="Loading insights">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, k) => (
              <Skeleton key={k} className="h-28" />
            ))}
          </div>
          <Skeleton className="h-80" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load shop insights" />
      ) : i ? (
        i.visits === 0 ? (
          <EmptyState icon={CalendarRange} title="No completed visits in this period" description="Insights appear as visits are marked done — from bookings and the walk-in queue." />
        ) : (
          <div className={cn('space-y-6 transition-opacity', q.isPlaceholderData && 'opacity-60')}>
            <p className="text-sm text-ink-soft">
              {formatDate(i.from)} to {formatDate(i.to)}
            </p>
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <KpiCard label="Visits" value={<AnimatedNumber value={i.visits} />} definition="Completed visits (bookings and walk-ins) in this period." />
              <KpiCard label="Services booked" value={<AnimatedNumber value={i.revenueCents} format={formatZAR} />} definition="The value of services on completed visits, at the prices charged. It is not cash counted or banked." />
              <KpiCard label="Average ticket" value={<AnimatedNumber value={i.averageTicketCents} format={formatZAR} />} definition="Services booked divided by visits." />
              <KpiCard
                label="Repeat customers"
                value={<AnimatedNumber value={i.repeatRate} format={(n) => `${Math.round(n)}%`} />}
                note={`${i.repeatCustomers} of ${i.uniqueCustomers} customers came more than once`}
                definition="Customers (by account, phone or name) with more than one completed visit in this period."
              />
              <KpiCard label="Walk-ins" value={<AnimatedNumber value={i.walkInShare} format={(n) => `${Math.round(n)}%`} />} definition="Share of visits that came through the walk-in queue." />
              <KpiCard label="House calls" value={<AnimatedNumber value={i.houseCallShare} format={(n) => `${n < 10 ? n.toFixed(1) : Math.round(n)}%`} />} definition="Share of visits done at the customer’s place." />
              <KpiCard
                label="Average queue wait"
                value={i.averageQueueWaitMinutes == null ? '—' : <AnimatedNumber value={i.averageQueueWaitMinutes} format={(n) => `${Math.round(n)} min`} />}
                definition="From joining the walk-in queue to sitting in the chair, averaged over walk-ins that started."
              />
              <KpiCard label="Unique customers" value={<AnimatedNumber value={i.uniqueCustomers} />} definition="Different customers with a completed visit in this period." />
            </div>

            <section aria-label="Busiest slot" className="flex flex-col gap-3 overflow-hidden rounded-2xl border border-emerald-brand/50 bg-ochre-soft p-4 sm:flex-row sm:items-center sm:p-5">
              <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-emerald-brand text-forest-950" aria-hidden>
                <Flame className="size-6" />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold text-ink-soft">Busiest slot</p>
                <p className="font-display text-2xl leading-tight font-bold text-heading">{i.busiestSlot}</p>
                <p className="mt-0.5 text-sm text-ink-soft">Have every chair working then, and keep the queue open — walk-ins wait least when more barbers are in.</p>
              </div>
            </section>

            <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="text-lg">When it gets busy</CardTitle>
                  <CardDescription>Completed visits by weekday and hour.</CardDescription>
                </CardHeader>
                <CardContent>
                  <Heatmap i={i} />
                </CardContent>
              </Card>
              <Card className="min-w-0">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Scissors className="size-5 text-forest-800" aria-hidden /> Top services
                  </CardTitle>
                  <CardDescription>By number of times done, with services booked.</CardDescription>
                </CardHeader>
                <CardContent>
                  <TopServices i={i} />
                </CardContent>
              </Card>
            </div>

            <Card className="min-w-0">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                  <Trophy className="size-5 text-forest-800" aria-hidden /> Barbers
                </CardTitle>
                <CardDescription>Ranked by services booked. No-show rate counts bookings marked as no-show; repeat is the share of their customers who came back.</CardDescription>
              </CardHeader>
              <CardContent>
                <Barbers list={i.barbers} />
              </CardContent>
            </Card>

            {i.notes.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-lg">
                    <Lightbulb className="size-5 text-ochre" aria-hidden /> Worth knowing
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ul className="stagger space-y-2 text-[15px] leading-relaxed">
                    {i.notes.map((n) => (
                      <li key={n} className="flex gap-2.5">
                        <span className="mt-2.5 size-1.5 shrink-0 rounded-full bg-ochre" aria-hidden />
                        {n}
                      </li>
                    ))}
                  </ul>
                </CardContent>
              </Card>
            )}
          </div>
        )
      ) : null}
    </div>
  )
}
