import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Car, Store, Users } from 'lucide-react'
import { Money } from '@/components/shared/Money'
import { BookingStatusBadge } from '@/components/shared/StatusBadges'
import { formatDayLabel, formatTime, formatWhen, jhbDate } from '@/lib/barbershop'
import type { BookingSummaryDto } from '@/types/barbershop'

/** One booking as a tappable row: time, customer, services, barber, status and (unless `showMoney` is off) its price. */
export function BookingListItem({
  b,
  showDate,
  showStaff = true,
  showMoney = true,
  actions,
}: {
  b: BookingSummaryDto
  showDate?: boolean
  showStaff?: boolean
  showMoney?: boolean
  actions?: ReactNode
}) {
  const house = b.locationType === 'house_call'
  return (
    <li className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center">
      <Link to={`/bookings/${b.id}`} className="group flex min-w-0 flex-1 gap-3 rounded-md outline-offset-4">
        <div className="w-14 shrink-0 rounded-lg bg-paper py-1.5 text-center">
          <p className="font-display text-lg leading-tight font-semibold tabular">{formatTime(b.startsAt)}</p>
          <p className="text-[11px] text-ink-muted">{showDate ? formatDayLabel(jhbDate(b.startsAt)) : `to ${formatTime(b.endsAt)}`}</p>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate font-semibold group-hover:underline">{b.customerName}</p>
            <BookingStatusBadge status={b.status} label={b.statusLabel} />
          </div>
          <p className="truncate text-[13px] text-ink-soft">{b.servicesSummary}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-muted">
            <span className="inline-flex items-center gap-1">
              {house ? <Car className="size-3.5" aria-hidden /> : <Store className="size-3.5" aria-hidden />}
              {house ? 'House call' : 'In the shop'}
            </span>
            {b.peopleCount > 1 && (
              <span className="inline-flex items-center gap-1">
                <Users className="size-3.5" aria-hidden /> {b.peopleCount} people
              </span>
            )}
            {showStaff && <span>{b.staffName ?? 'Any barber'}</span>}
            <span className="font-mono">{b.reference}</span>
          </p>
          {b.status === 'reschedule_proposed' && b.proposedStartsAt && (
            <p className="mt-1 text-[12px] font-medium text-amber-800">
              {b.proposedBy === 'customer' ? 'Customer asked for' : 'You proposed'} {formatWhen(b.proposedStartsAt)}
            </p>
          )}
        </div>
        {showMoney && (
          <div className="shrink-0 text-right">
            <Money cents={b.totalCents} className="font-semibold" />
            {b.paidCents > 0 && (
              <p className="text-[12px] text-ink-muted">
                paid <Money cents={b.paidCents} />
              </p>
            )}
          </div>
        )}
      </Link>
      {actions && <div className="flex flex-wrap gap-2 sm:justify-end">{actions}</div>}
    </li>
  )
}
