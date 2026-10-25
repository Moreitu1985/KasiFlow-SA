import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Banknote, BarChart3, CalendarClock, ChevronRight, ListOrdered, Map as MapIcon, ReceiptText, Sprout, TrendingUp, Wallet, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Callout } from '@/components/shared/Callout'
import { KpiCard } from '@/components/shared/KpiCard'
import { HeroPanel, HeroStat } from '@/components/shared/HeroPanel'
import { Skeleton } from '@/components/ui/skeleton'
import { AppBadge } from '@/layouts/shell'
import { cn } from '@/lib/utils'
import { Money } from '@/components/shared/Money'
import { AnimatedNumber } from '@/components/shared/AnimatedNumber'
import { CardsSkeleton, ChartSkeleton, EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { IncomeExpenseChart } from '@/components/charts/IncomeExpenseChart'
import { ForecastChart } from '@/components/charts/ForecastChart'
import { addDays, formatDate, formatZAR, todayJhb } from '@/lib/format'
import { useBusiness } from '@/features/business/BusinessProvider'
import { useRecord } from '@/features/transactions/RecordProvider'
import { useRecentTransactions } from '@/features/transactions/api'
import { TransactionListItem } from '@/features/transactions/TransactionRow'
import { RecommendationCard } from '@/features/growth/RecommendationCard'
import { useSettings } from '@/features/settings/api'
import type { DashboardPeriod } from '@/types/api'
import { useDashboardSummary } from './api'
import { DemoDataCard } from '@/features/business/DemoDataCard'
import { useAccess } from '@/features/access/useAccess'
import { BriefingCard } from '@/features/notifications/Briefing'
import { PreliminaryCallout } from '@/components/shared/PreliminaryCallout'
import { MoneyPanel } from '@/features/money/MoneyPanel'

const PERIODS: { value: DashboardPeriod; label: string }[] = [
  { value: 'this_week', label: 'This week' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_30_days', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
]

const SHORTCUTS: { key: string; to: string; title: string; body: string; icon: LucideIcon }[] = [
  { key: 'insights', to: '/insights', title: 'Shop insights', body: 'Busiest hours, repeat customers, each barber’s numbers', icon: BarChart3 },
  { key: 'payroll', to: '/payroll', title: 'Barber pay', body: 'Statements, pay terms and payouts you made', icon: Banknote },
  { key: 'queue', to: '/queue', title: 'Walk-in queue', body: 'Who is waiting now and the next wait', icon: ListOrdered },
  { key: 'houseCallMap', to: '/map', title: 'House-call map', body: 'Today’s visits and shared check-ins', icon: MapIcon },
]

/** Owner shortcuts to the deeper screens (only the ones this app has). */
function Shortcuts() {
  const { experience } = useAccess()
  const items = SHORTCUTS.filter((x) => experience.has(x.key))
  if (items.length === 0) return null
  return (
    <nav aria-label="More for the owner" className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-4">
      {items.map((x) => (
        <Link key={x.key} to={x.to} className="lift group flex min-h-20 items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-tint-strong text-heading transition-colors group-hover:bg-emerald-brand group-hover:text-forest-950" aria-hidden>
            <x.icon className="size-5" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{x.title}</span>
            <span className="block text-[13px] leading-snug text-ink-muted">{x.body}</span>
          </span>
          <ChevronRight className="size-5 shrink-0 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
        </Link>
      ))}
    </nav>
  )
}

export function DashboardPage() {
  const { activeBusiness } = useBusiness()
  const { openRecord } = useRecord()
  const [period, setPeriod] = useState<DashboardPeriod>('this_month')
  const [from, setFrom] = useState(addDays(todayJhb(), -29))
  const [to, setTo] = useState(todayJhb())
  const summary = useDashboardSummary(period, from, to)
  const recent = useRecentTransactions(8)
  const settings = useSettings()
  const s = summary.data
  const bufferCents = settings.data?.cashBufferCents ?? 0
  const { can, experience } = useAccess()
  const canRecord = can('manageFinancials')

  return (
    <div className="space-y-7">
      <HeroPanel as="header">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <AppBadge experience={experience} who={activeBusiness?.name} tone="dark" />
            <h1 className="mt-3 text-[2rem] leading-tight font-bold text-white sm:text-[2.4rem]">Business overview</h1>
            <p className="mt-1 text-[15px] text-cream">
              {s ? `${s.period.label}: ${formatDate(s.period.from)} to ${formatDate(s.period.to)}` : 'Your shop’s numbers'} · only the owner sees this page
            </p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div>
              <Label htmlFor="period" className="text-cream">
                Period
              </Label>
              <NativeSelect id="period" className="mt-1.5 border-white sm:w-44" value={period} onChange={(e) => setPeriod(e.target.value as DashboardPeriod)}>
                {PERIODS.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            {period === 'custom' && (
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="from" className="text-cream">
                    From
                  </Label>
                  <Input id="from" type="date" className="mt-1.5" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="to" className="text-cream">
                    To
                  </Label>
                  <Input id="to" type="date" className="mt-1.5" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>
            )}
            <div className={canRecord ? 'hidden gap-2 sm:flex' : 'hidden'}>
              <Button variant="accent" onClick={() => openRecord('income')}>
                <ArrowDownLeft /> Record sale
              </Button>
              <Button variant="outline" className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => openRecord('expense')}>
                <ArrowUpRight /> Record expense
              </Button>
            </div>
          </div>
        </div>
        {summary.isLoading ? (
          <div className="mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4" aria-busy aria-label="Loading">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-24 [--skel-shine:rgb(255_255_255/0.08)] [--skel:rgb(255_255_255/0.07)]" />
            ))}
          </div>
        ) : s ? (
          <div className={cn('mt-5 grid grid-cols-2 gap-2.5 lg:grid-cols-4', summary.isFetching && summary.isPlaceholderData && 'opacity-70')}>
            <HeroStat
              label="Cash balance"
              icon={Wallet}
              value={<AnimatedNumber value={s.cashBalanceCents} format={formatZAR} />}
              tone={s.cashBalanceCents < 0 ? 'attention' : 'default'}
              hint={s.awaitingConfirmationCents > 0 ? <>Includes {formatZAR(s.awaitingConfirmationCents)} awaiting confirmation</> : 'Recorded cash today'}
            />
            <HeroStat label="Income" icon={ArrowDownLeft} value={<AnimatedNumber value={s.incomeCents} format={formatZAR} />} tone="good" hint={s.period.label} />
            <HeroStat label="Expenses" icon={ArrowUpRight} value={<AnimatedNumber value={s.expensesCents} format={formatZAR} />} hint={s.period.label} />
            <HeroStat
              label="Net recorded result"
              icon={TrendingUp}
              value={<AnimatedNumber value={s.netResultCents} format={formatZAR} />}
              tone={s.netResultCents < 0 ? 'attention' : 'default'}
              hint="Income minus expenses you recorded; not audited profit"
            />
          </div>
        ) : null}
      </HeroPanel>

      <Shortcuts />

      {s && !s.openingBalanceConfigured && can('manageSettings') && (
        <Callout
          tone="warning"
          title="Set your opening cash balance"
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/settings">Set opening balance</Link>
            </Button>
          }
        >
          Your cash balance and forecast start from R0.00 until you record how much cash you had on a specific day.
        </Callout>
      )}

      {s && !s.hasAnyTransactions && canRecord && (
        <EmptyState
          icon={ReceiptText}
          title="Start with today's numbers"
          description="Record your first sale or expense. KasiFlow builds your cash balance, charts and warnings from what you record — nothing is made up."
          action={
            <>
              <Button onClick={() => openRecord('income')}>Record a sale</Button>
              <Button variant="outline" onClick={() => openRecord('expense')}>
                Record an expense
              </Button>
            </>
          }
        />
      )}
      {s && !s.hasAnyTransactions && canRecord && <DemoDataCard compact />}

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Income vs expenses</CardTitle>
            <CardDescription>Last 6 months, recorded transactions</CardDescription>
          </CardHeader>
          <CardContent>
            {summary.isLoading ? <ChartSkeleton /> : s ? <IncomeExpenseChart data={s.incomeVsExpenses} /> : null}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Cash forecast</CardTitle>
            <CardDescription>
              Next {s?.forecast.horizonDays ?? '…'} days ·{' '}
              <Link to="/cash-flow" className="font-medium text-forest-800 hover:underline">
                Details
              </Link>
            </CardDescription>
          </CardHeader>
          <CardContent>
            {summary.isLoading ? (
              <ChartSkeleton />
            ) : s ? (
              <>
                <PreliminaryCallout isPreliminary={s.forecast.isPreliminary} reason={s.forecast.preliminaryReason} className="mb-4" />
                <ForecastChart
                  data={s.forecastSeries.map((p) => ({
                    date: p.date,
                    expectedCents: p.expectedBalanceCents,
                    conservativeCents: p.conservativeBalanceCents,
                    optimisticCents: p.optimisticBalanceCents,
                  }))}
                  bufferCents={bufferCents}
                  showScenarios
                />
              </>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <section aria-labelledby="priority-title">
        <div className="mb-3 flex items-end justify-between">
          <div>
            <h2 id="priority-title" className="text-lg font-bold">
              Priority actions
            </h2>
            <p className="text-sm text-ink-muted">The most important findings from the Growth Engine</p>
          </div>
          <Button asChild variant="link">
            <Link to="/growth">Open Growth Engine</Link>
          </Button>
        </div>
        {summary.isLoading ? (
          <ListSkeleton rows={2} />
        ) : s && s.priorityActions.length > 0 ? (
          <div className="space-y-4">
            {s.priorityActions.map((r) => (
              <RecommendationCard key={r.id} rec={r} />
            ))}
          </div>
        ) : s ? (
          <EmptyState icon={Sprout} title="No priority actions" description="Nothing in your records needs urgent attention right now." />
        ) : null}
      </section>

      <section aria-labelledby="owed-title" className="space-y-3">
        <h2 id="owed-title" className="text-lg font-bold">
          Owed, due and forecast
        </h2>
      {summary.isLoading ? (
          <CardsSkeleton count={4} />
        ) : summary.isError ? (
          <ErrorState error={summary.error} onRetry={() => summary.refetch()} title="Could not load your overview" />
        ) : s ? (
          <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
            <KpiCard
              label="Customers owe you"
              value={<Money cents={s.outstandingReceivablesCents} />}
              note={s.overdueReceivablesCents > 0 ? <span className="text-red-700"><Money cents={s.overdueReceivablesCents} className="font-semibold" /> overdue</span> : 'Nothing overdue'}
              tone={s.overdueReceivablesCents > 0 ? 'warning' : 'default'}
              definition="The unpaid balance of all open customer debts. Debts are not income until they are paid."
              to="/customers"
            />
            <KpiCard
              label="Upcoming supplier bills"
              value={<Money cents={s.upcomingPayablesCents} />}
              note={s.overduePayablesCents > 0 ? <span className="text-red-700"><Money cents={s.overduePayablesCents} className="font-semibold" /> overdue</span> : 'Due in the next 30 days'}
              tone={s.overduePayablesCents > 0 ? 'warning' : 'default'}
              definition="Open supplier bills due within the next 30 days, including any that are already overdue."
              to="/suppliers"
            />
            <KpiCard
              label={`Lowest balance, next ${s.forecast.horizonDays} days`}
              value={<Money cents={s.forecast.lowestExpectedBalanceCents} tone="auto" />}
              note={
                s.forecast.firstShortageDate ? (
                  <span className="text-red-700">Possible shortage from {formatDate(s.forecast.firstShortageDate)}</span>
                ) : s.forecast.firstBelowBufferDate ? (
                  <span className="text-amber-800">Below buffer from {formatDate(s.forecast.firstBelowBufferDate)}</span>
                ) : (
                  `on ${formatDate(s.forecast.lowestExpectedBalanceDate)}`
                )
              }
              tone={s.forecast.firstShortageDate ? 'critical' : s.forecast.firstBelowBufferDate ? 'warning' : 'default'}
              definition="The lowest projected end-of-day balance in the forecast period, based on planned transactions, open bills and expected customer payments. A forecast, not a guarantee."
              to="/cash-flow"
            />
            <KpiCard
              label="Open recommendations"
              value={s.openRecommendations.total}
              note={
                s.openRecommendations.total > 0 ? (
                  <span className="flex flex-wrap gap-1">
                    {s.openRecommendations.critical > 0 && <Badge variant="critical">{s.openRecommendations.critical} critical</Badge>}
                    {s.openRecommendations.warning > 0 && <Badge variant="warning">{s.openRecommendations.warning} warning</Badge>}
                    {s.openRecommendations.informational > 0 && <Badge variant="info">{s.openRecommendations.informational} info</Badge>}
                  </span>
                ) : (
                  'Nothing flagged'
                )
              }
              tone={s.openRecommendations.critical > 0 ? 'critical' : 'default'}
              definition="Findings from the Growth Engine's fixed rules that you have not yet dismissed or resolved."
              to="/growth"
            />
          </div>
        ) : null}
      </section>

      <MoneyPanel />

      <BriefingCard />

      <div className="grid min-w-0 grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="min-w-0 lg:col-span-3">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Recent transactions</CardTitle>
            <Button asChild variant="link">
              <Link to="/transactions">View all</Link>
            </Button>
          </CardHeader>
          {recent.isLoading ? (
            <CardContent>
              <ListSkeleton rows={4} className="border-0" />
            </CardContent>
          ) : recent.isError ? (
            <CardContent>
              <ErrorState error={recent.error} onRetry={() => recent.refetch()} />
            </CardContent>
          ) : recent.data?.length ? (
            <div className="divide-y divide-line border-t border-line">
              {recent.data.map((t) => (
                <TransactionListItem key={t.id} t={t} />
              ))}
            </div>
          ) : (
            <CardContent>
              <p className="text-sm text-ink-muted">No transactions yet.</p>
            </CardContent>
          )}
        </Card>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Upcoming bills</CardTitle>
              <Button asChild variant="link">
                <Link to="/suppliers">All bills</Link>
              </Button>
            </CardHeader>
            <CardContent>
              {s && s.upcomingObligations.length === 0 && <p className="text-sm text-ink-muted">No open supplier bills.</p>}
              <ul className="divide-y divide-line">
                {s?.upcomingObligations.map((o) => (
                  <li key={o.payableId}>
                    <Link to={`/suppliers/bills/${o.payableId}`} className="flex items-start gap-3 py-2.5 hover:bg-paper">
                      <CalendarClock className={`mt-0.5 size-4 shrink-0 ${o.isOverdue ? 'text-red-700' : 'text-ink-muted'}`} aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{o.supplierName}</p>
                        <p className="truncate text-[13px] text-ink-muted">
                          {o.description} · {o.isOverdue ? <span className="font-semibold text-red-700">overdue since {formatDate(o.dueDate)}</span> : `due ${formatDate(o.dueDate)}`}
                        </p>
                      </div>
                      <span className="text-sm font-semibold tabular">{formatZAR(o.remainingCents)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {s && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Business readiness</CardTitle>
                <Button asChild variant="link">
                  <Link to="/readiness">Continue</Link>
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span>Registration steps</span>
                    <span className="font-semibold tabular">{Math.round(s.registrationProgressPercent)}%</span>
                  </div>
                  <Progress value={s.registrationProgressPercent} label="Registration progress" />
                </div>
                <div>
                  <div className="mb-1.5 flex justify-between text-sm">
                    <span>Funding readiness</span>
                    <span className="font-semibold tabular">{Math.round(s.fundingReadinessPercent)}%</span>
                  </div>
                  <Progress value={s.fundingReadinessPercent} label="Funding readiness" />
                </div>
                <p className="text-[12px] text-ink-muted">A checklist of documents and records — not a credit score.</p>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
