import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Cog, Inbox, RefreshCw, Sprout } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAccess } from '@/features/access/useAccess'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/input'
import { RoleHeader } from '@/features/access/RoleHeader'
import { Callout } from '@/components/shared/Callout'
import { ChartSkeleton, EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { SeverityBadge } from '@/components/shared/Badges'
import { Skeleton } from '@/components/ui/skeleton'
import { ForecastChart } from '@/components/charts/ForecastChart'
import { PreliminaryCallout } from '@/components/shared/PreliminaryCallout'
import { errorMessage } from '@/lib/apiClient'
import { pluralize } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { RecommendationStatus, Severity } from '@/types/api'
import { useForecast, useGrowthRules, useRecommendations, useRefreshGrowth } from './api'
import { HeadlineRisk } from './HeadlineRisk'
import { RecommendationCard } from './RecommendationCard'
import { HorizonSelect } from '@/features/cashflow/HorizonSelect'

const SEVERITY_FILTERS: { value: Severity | ''; label: string }[] = [
  { value: '', label: 'All' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'informational', label: 'Info' },
]

export function GrowthPage() {
  const [days, setDays] = useState<number | undefined>(undefined)
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [status, setStatus] = useState<RecommendationStatus | 'all'>('open')
  const forecast = useForecast(days)
  const recs = useRecommendations(status, severity)
  const rules = useGrowthRules()
  const refresh = useRefreshGrowth()

  const runAnalysis = () =>
    refresh.mutate(undefined, {
      onSuccess: (r) =>
        toast.success('Analysis complete', {
          description: `${pluralize(r.created, 'new recommendation')}, ${r.updated} updated, ${r.autoResolved} resolved automatically.`,
        }),
      onError: (err) => toast.error('Could not run the analysis', { description: errorMessage(err) }),
    })

  const f = forecast.data
  const canEdit = useAccess().can('manageFinancials')

  return (
    <div className="space-y-8">
      <RoleHeader
        title="Growth Engine"
        description="KasiFlow checks your own records against a fixed set of rules — late debts, bills due before money comes in, spending trends — and shows you exactly which records triggered each finding. Deterministic rules, no AI guessing."
        actions={
          canEdit && (
            <Button onClick={runAnalysis} loading={refresh.isPending}>
              <RefreshCw /> Re-run analysis
            </Button>
          )
        }
       
      />

      {f && !f.openingBalanceConfigured && (
        <Callout
          tone="warning"
          title="Your opening cash balance is not set"
          action={
            <Button asChild size="sm" variant="outline">
              <Link to="/settings">Set opening balance</Link>
            </Button>
          }
        >
          The forecast starts from R0.00 until you tell KasiFlow how much cash you had on a specific day.
        </Callout>
      )}

      {forecast.isLoading ? (
        <Skeleton className="h-48 w-full" />
      ) : forecast.isError ? (
        <ErrorState error={forecast.error} onRetry={() => forecast.refetch()} title="Could not load the forecast" />
      ) : f ? (
        <>
          <PreliminaryCallout isPreliminary={f.isPreliminary} reason={f.preliminaryReason} className="mb-4" />
          <HeadlineRisk f={f} />
        </>
      ) : null}

      <Card>
        <CardHeader className="sm:flex-row sm:items-end sm:justify-between">
          <div>
            <CardTitle>Cash forecast</CardTitle>
            <CardDescription>Day by day from today. Shaded days show a possible shortage.</CardDescription>
          </div>
          <HorizonSelect value={days ?? f?.horizonDays} onChange={setDays} />
        </CardHeader>
        <CardContent>
          {forecast.isLoading ? (
            <ChartSkeleton />
          ) : f ? (
            <ForecastChart
              data={f.days.map((d) => ({ date: d.date, expectedCents: d.expectedClosingCents, conservativeCents: d.conservativeClosingCents, optimisticCents: d.optimisticClosingCents }))}
              bufferCents={f.cashBufferCents}
              scenarios={f.scenarios}
            />
          ) : null}
          <p className="mt-3 text-[13px] text-ink-muted">
            Forecast, not a promise. See the{' '}
            <Link to="/cash-flow" className="font-medium text-forest-800 hover:underline">
              daily cash flow table
            </Link>{' '}
            for every amount behind these lines.
          </p>
        </CardContent>
      </Card>

      <section aria-labelledby="recs-title">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="recs-title" className="text-xl font-bold">
              Recommendations
            </h2>
            <p className="text-sm text-ink-muted">Most severe first. Mark them resolved once you have acted.</p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div role="group" aria-label="Filter by severity" className="flex rounded-md border border-line-strong bg-surface p-0.5">
              {SEVERITY_FILTERS.map((s) => (
                <button
                  key={s.value}
                  type="button"
                  aria-pressed={severity === s.value}
                  onClick={() => setSeverity(s.value)}
                  className={cn(
                    'cursor-pointer rounded px-3 py-1.5 text-[13px] font-semibold transition-colors',
                    severity === s.value ? 'bg-primary text-primary-fg' : 'text-ink-soft hover:bg-forest-50',
                  )}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <div>
              <Label htmlFor="rec-status" className="sr-only">
                Status
              </Label>
              <NativeSelect id="rec-status" className="h-9 w-40" value={status} onChange={(e) => setStatus(e.target.value as RecommendationStatus | 'all')}>
                <option value="open">Open</option>
                <option value="dismissed">Dismissed</option>
                <option value="resolved">Resolved</option>
                <option value="all">All statuses</option>
              </NativeSelect>
            </div>
          </div>
        </div>

        {recs.isLoading ? (
          <ListSkeleton rows={3} />
        ) : recs.isError ? (
          <ErrorState error={recs.error} onRetry={() => recs.refetch()} />
        ) : !recs.data?.length ? (
          <EmptyState
            icon={status === 'open' ? Sprout : Inbox}
            title={status === 'open' ? 'Nothing needs your attention right now' : 'No recommendations here'}
            description={
              status === 'open'
                ? 'The rules found nothing to flag in your current records. As you record sales, expenses, debts and bills, the engine will point out risks and opportunities.'
                : 'Try a different status or severity filter.'
            }
          />
        ) : (
          <div className="space-y-4">
            {recs.data.map((r, i) => (
              <RecommendationCard key={r.id} rec={r} defaultOpen={i === 0 && r.status === 'open'} />
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="how-title" className="rounded-lg border border-line bg-surface">
        <div className="flex items-start gap-3 border-b border-line px-5 py-4">
          <Cog className="mt-1 size-5 text-forest-800" aria-hidden />
          <div>
            <h2 id="how-title" className="text-lg font-bold">
              How it works
            </h2>
            <p className="text-sm leading-relaxed text-ink-soft">
              Each rule is a fixed calculation on your own records. The same records always give the same result, and every finding lists the
              records behind it. Recommendations support your decisions — they are not financial advice and cannot guarantee results.
            </p>
          </div>
        </div>
        <div className="grid gap-6 p-5 lg:grid-cols-[3fr_2fr]">
          <div>
            <h3 className="font-sans text-sm font-semibold">Rules the engine checks</h3>
            {rules.isLoading ? (
              <Skeleton className="mt-3 h-32" />
            ) : rules.isError ? (
              <ErrorState className="mt-3" error={rules.error} onRetry={() => rules.refetch()} />
            ) : (
              <ul className="mt-3 divide-y divide-line rounded-md border border-line">
                {rules.data?.map((r) => (
                  <li key={r.code} className="flex flex-col gap-1 px-3 py-3 sm:flex-row sm:items-start sm:gap-3">
                    <div className="flex-1">
                      <p className="text-sm font-semibold">
                        {r.name} <span className="font-normal text-ink-muted">· {r.code}</span>
                      </p>
                      <p className="text-[13px] leading-relaxed text-ink-soft">{r.description}</p>
                    </div>
                    <SeverityBadge severity={r.severity} />
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3 className="font-sans text-sm font-semibold">Forecast assumptions</h3>
            {f ? (
              <ul className="mt-3 list-disc space-y-1.5 pl-5 text-[13px] leading-relaxed text-ink-soft">
                {f.assumptions.map((a, i) => (
                  <li key={i}>{a}</li>
                ))}
              </ul>
            ) : (
              <Skeleton className="mt-3 h-24" />
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
