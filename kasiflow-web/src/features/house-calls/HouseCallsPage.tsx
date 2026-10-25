import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Car } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Callout } from '@/components/shared/Callout'
import { DateRangeBar } from '@/components/shared/DateRangeBar'
import { Money } from '@/components/shared/Money'
import { RoleHeader } from '@/features/access/RoleHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { BookingStatusBadge } from '@/components/shared/StatusBadges'
import { addDays, todayJhb } from '@/lib/format'
import { formatWhen } from '@/lib/barbershop'
import { useHouseCalls } from '@/features/bookings/api'
import type { HouseCallListItemDto } from '@/types/barbershop'

function Contribution({ h }: { h: HouseCallListItemDto }) {
  const e = h.economics
  if (e.hasActualCosts)
    return (
      <span>
        <Money cents={e.actualContributionCents} tone="auto" className="font-semibold" /> <span className="block text-[11px] text-ink-muted">actual</span>
      </span>
    )
  if (e.estimatedContributionCents != null)
    return (
      <span>
        <Money cents={e.estimatedContributionCents} tone="auto" className="font-semibold" /> <span className="block text-[11px] text-ink-muted">estimated</span>
      </span>
    )
  return <span className="text-ink-muted">—</span>
}

export function HouseCallsPage() {
  const [range, setRange] = useState({ from: addDays(todayJhb(), -30), to: addDays(todayJhb(), 30) })
  const q = useHouseCalls(range.from, range.to)
  const caveat = q.data?.[0]?.economics.caveat

  return (
    <div className="space-y-5">
      <RoleHeader title="House calls" description="Visits at the customer’s place: where, how far, and whether the trip was worth it." />
      <DateRangeBar from={range.from} to={range.to} onChange={setRange} />
      <Callout tone="info" title="How to read these numbers">
        {caveat ?? 'Contribution = revenue from the visit minus the direct costs recorded for it. It is before overheads, unrecorded wages and tax.'} Distances are
        entered by the team, not calculated.
      </Callout>
      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={Car} title="No house calls in these dates" />
      ) : (
        <>
          <ul className="space-y-3 md:hidden">
            {q.data.map((h) => (
              <li key={h.booking.id}>
                <Link to={`/bookings/${h.booking.id}`} className="block rounded-lg border border-line bg-surface p-4 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{h.booking.customerName}</p>
                      <p className="text-[13px] text-ink-muted">
                        {formatWhen(h.booking.startsAt)} · {h.booking.staffName ?? 'Unassigned'}
                      </p>
                    </div>
                    <BookingStatusBadge status={h.booking.status} label={h.booking.statusLabel} />
                  </div>
                  <p className="mt-2 text-[13px]">
                    {h.town ?? 'Town not given'} · {h.distanceLabel}
                  </p>
                  <dl className="mt-2 grid grid-cols-2 gap-2 text-sm">
                    <div>
                      <dt className="text-[12px] text-ink-muted">Revenue</dt>
                      <dd><Money cents={h.economics.revenueCents} /></dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-ink-muted">Contribution</dt>
                      <dd><Contribution h={h} /></dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-ink-muted">Estimated costs</dt>
                      <dd>{h.economics.estimatedCostsCents == null ? '—' : <Money cents={h.economics.estimatedCostsCents} />}</dd>
                    </div>
                    <div>
                      <dt className="text-[12px] text-ink-muted">Actual costs</dt>
                      <dd><Money cents={h.economics.actualCostsCents} /></dd>
                    </div>
                  </dl>
                </Link>
              </li>
            ))}
          </ul>
          <Card className="hidden min-w-0 overflow-hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Customer</TH>
                  <TH>Town · distance</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Revenue</TH>
                  <TH className="text-right">Est. costs</TH>
                  <TH className="text-right">Actual costs</TH>
                  <TH className="text-right">Contribution</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.map((h) => (
                  <TR key={h.booking.id} className="hover:bg-paper/60">
                    <TD className="whitespace-nowrap">{formatWhen(h.booking.startsAt)}</TD>
                    <TD>
                      <Link to={`/bookings/${h.booking.id}`} className="font-medium text-forest-800 hover:underline">
                        {h.booking.customerName}
                      </Link>
                      <span className="block text-[12px] text-ink-muted">{h.booking.staffName ?? 'Unassigned'}</span>
                    </TD>
                    <TD className="text-[13px]">
                      {h.town ?? '—'}
                      <span className="block text-ink-muted">{h.distanceLabel}</span>
                    </TD>
                    <TD><BookingStatusBadge status={h.booking.status} label={h.booking.statusLabel} /></TD>
                    <TD className="text-right"><Money cents={h.economics.revenueCents} /></TD>
                    <TD className="text-right">{h.economics.estimatedCostsCents == null ? '—' : <Money cents={h.economics.estimatedCostsCents} />}</TD>
                    <TD className="text-right"><Money cents={h.economics.actualCostsCents} /></TD>
                    <TD className="text-right"><Contribution h={h} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  )
}
