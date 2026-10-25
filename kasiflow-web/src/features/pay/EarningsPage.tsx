import { useMemo, useState } from 'react'
import { BarChart3, Info, UserX } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Callout } from '@/components/shared/Callout'
import { Segmented } from '@/components/shared/Segmented'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { PAY_PERIODS, payPeriodRange, type PayPeriodKey } from '@/lib/earnings'
import { todayJhb } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RoleHeader } from '@/features/access/RoleHeader'
import { useWorkspace } from '@/features/team/api'
import { useEarnings } from './api'
import { EarningsChart } from './EarningsChart'
import { BalanceStatement, StatementBreakdown } from './Statement'

/**
 * /earnings — "My earnings": the signed-in barber's own statement for a period, worked out from completed visits and
 * their pay terms. A statement to agree on with the owner, not a payslip.
 */
export function EarningsPage() {
  const ws = useWorkspace()
  const me = ws.data?.profile ?? null
  const [period, setPeriod] = useState<PayPeriodKey>('this_week')
  const range = useMemo(() => payPeriodRange(period, todayJhb()), [period])
  const q = useEarnings(me?.id, range)
  const e = q.data

  return (
    <div className="space-y-6">
      <RoleHeader
        who={me?.displayName}
        title="My earnings"
        description="What you earned from completed visits, worked out from your pay terms. A statement to agree on with the owner — not a payslip."
        actions={<Segmented label="Period" value={period} options={PAY_PERIODS.map((p) => ({ value: p.key, label: p.label }))} onChange={setPeriod} />}
      />

      {ws.isLoading || (q.isLoading && !!me) ? (
        <div className="space-y-4" aria-busy aria-label="Loading your statement">
          <Skeleton className="h-36 rounded-2xl" />
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24" />
            ))}
          </div>
        </div>
      ) : ws.isError ? (
        <ErrorState error={ws.error} onRetry={() => ws.refetch()} />
      ) : !me ? (
        <EmptyState icon={UserX} title="No barber profile linked to your login" description="Earnings are worked out per barber profile. Ask the owner to link your login to your profile." />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load your statement" />
      ) : e ? (
        <div className={cn('space-y-6 transition-opacity', q.isPlaceholderData && 'opacity-60')}>
          <BalanceStatement e={e} />
          <StatementBreakdown e={e} />
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-lg">
                <BarChart3 className="size-5 text-forest-800" aria-hidden /> Day by day
              </CardTitle>
              <CardDescription>Services you completed each day, at your prices.</CardDescription>
            </CardHeader>
            <CardContent>
              <EarningsChart e={e} />
            </CardContent>
          </Card>
          <Callout tone="neutral" title="How this is worked out">
            <p>{e.explanation}</p>
            <p className="mt-1.5 inline-flex items-start gap-1.5 text-[13px] text-ink-muted">
              <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {e.disclaimer}
            </p>
          </Callout>
        </div>
      ) : null}
    </div>
  )
}
