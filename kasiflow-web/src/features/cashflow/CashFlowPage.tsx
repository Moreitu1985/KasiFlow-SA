import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { RoleHeader } from '@/features/access/RoleHeader'
import { Callout } from '@/components/shared/Callout'
import { KpiCard } from '@/components/shared/KpiCard'
import { Money } from '@/components/shared/Money'
import { CardsSkeleton, ChartSkeleton, ErrorState, ListSkeleton } from '@/components/shared/States'
import { ForecastChart } from '@/components/charts/ForecastChart'
import { PreliminaryCallout } from '@/components/shared/PreliminaryCallout'
import { formatDate } from '@/lib/format'
import { useForecast } from '@/features/growth/api'
import { HorizonSelect } from './HorizonSelect'
import { ExcludedAndAssumptions, ForecastTable } from './ForecastTable'

export function CashFlowPage() {
  const [days, setDays] = useState<number>()
  const [activeOnly, setActiveOnly] = useState(true)
  const q = useForecast(days)
  const f = q.data

  return (
    <div className="space-y-6">
      <RoleHeader
        title="Cash flow forecast"
        description="Where your cash balance is heading, day by day, from what you have recorded: planned income and expenses, supplier bills and debts customers owe you."
        actions={<HorizonSelect value={days ?? f?.horizonDays} onChange={setDays} />}
       
      />

      {q.isError && <ErrorState error={q.error} onRetry={() => q.refetch()} />}

      {f && !f.openingBalanceConfigured && (
        <Callout
          tone="warning"
          title="Opening balance not set"
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/settings">Set it now</Link>
            </Button>
          }
        >
          The forecast assumes you started with R0.00. Set your opening cash balance for a realistic picture.
        </Callout>
      )}

      <PreliminaryCallout isPreliminary={f?.isPreliminary} reason={f?.preliminaryReason} />

      {q.isLoading ? (
        <CardsSkeleton />
      ) : f ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard label="Starting balance today" value={<Money cents={f.openingBalanceCents} tone="auto" />} definition="Your recorded cash balance at the start of today: opening balance plus posted income minus posted expenses." />
          <KpiCard
            label="Lowest expected balance"
            value={<Money cents={f.lowestExpected.balanceCents} tone="auto" />}
            note={`on ${formatDate(f.lowestExpected.date)}`}
            tone={f.lowestExpected.balanceCents < 0 ? 'critical' : f.firstBelowBufferDate ? 'warning' : 'default'}
            definition="The lowest end-of-day balance in the forecast, counting customer debts you expect to be paid on their due dates."
          />
          <KpiCard
            label="Lowest conservative balance"
            value={<Money cents={f.lowestConservative.balanceCents} tone="auto" />}
            note={`on ${formatDate(f.lowestConservative.date)}`}
            tone={f.lowestConservative.balanceCents < 0 ? 'warning' : 'default'}
            definition="The same forecast, but assuming no customer pays what they owe. A cautious view."
          />
          {f.lowestOptimistic && (
            <KpiCard
              label="Lowest optimistic balance"
              value={<Money cents={f.lowestOptimistic.balanceCents} tone="auto" />}
              note={f.totalOptimisticExtraCents > 0 ? <>Adds <Money cents={f.totalOptimisticExtraCents} /> not yet certain</> : `on ${formatDate(f.lowestOptimistic.date)}`}
              definition="The same forecast, plus overdue customer debts and pending provider payments arriving tomorrow. A hopeful view, not a promise."
            />
          )}
          <KpiCard
            label={`Money out in ${f.horizonDays} days`}
            value={<Money cents={f.totals.outflowsCents} />}
            note={
              <>
                In: <Money cents={f.totals.scheduledInflowsCents} /> planned + <Money cents={f.totals.expectedInflowsCents} /> expected
              </>
            }
            definition="Total planned expenses and open supplier bills in the forecast period, compared with planned income and expected customer payments."
          />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Forecast</CardTitle>
          <CardDescription>Three scenarios from the same records. Expected includes debts customers should pay; conservative leaves them out; optimistic adds overdue debts and pending payments.</CardDescription>
        </CardHeader>
        <CardContent>
          {q.isLoading ? (
            <ChartSkeleton />
          ) : f ? (
            <ForecastChart
              data={f.days.map((d) => ({ date: d.date, expectedCents: d.expectedClosingCents, conservativeCents: d.conservativeClosingCents, optimisticCents: d.optimisticClosingCents }))}
              bufferCents={f.cashBufferCents}
              scenarios={f.scenarios}
              showScenarios
            />
          ) : null}
        </CardContent>
      </Card>

      <section>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-lg font-bold">Day by day</h2>
          <div className="flex items-center gap-2">
            <Switch id="active-only" checked={activeOnly} onCheckedChange={setActiveOnly} />
            <Label htmlFor="active-only" className="font-normal">
              Only show days with activity or warnings
            </Label>
          </div>
        </div>
        {q.isLoading ? <ListSkeleton rows={6} /> : f ? <ForecastTable forecast={f} onlyActiveDays={activeOnly} /> : null}
      </section>

      {f && <ExcludedAndAssumptions forecast={f} />}
    </div>
  )
}
