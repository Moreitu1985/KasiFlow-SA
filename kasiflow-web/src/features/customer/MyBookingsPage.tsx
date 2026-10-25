import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Car, ChevronRight, MessageCircleQuestion, Scissors, Search, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Money } from '@/components/shared/Money'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { BookingStatusBadge } from '@/components/shared/StatusBadges'
import { formatTimeRange, formatWhen } from '@/lib/barbershop'
import { splitCustomerBookings } from '@/lib/customer'
import { cn } from '@/lib/utils'
import type { CustomerBookingDto } from '@/types/customer'
import { CustomerHeader } from './CustomerHeader'
import { useCustomerAccount, useCustomerBookings } from './api'

const DAY = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric' })
const MONTH = new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', month: 'short' })

function Row({ b, past }: { b: CustomerBookingDto; past?: boolean }) {
  const house = b.locationType === 'house_call'
  const d = new Date(b.startsAt)
  return (
    <li>
      <Link
        to={`/c/bookings/${encodeURIComponent(b.reference)}`}
        className={cn(
          'flex min-h-20 items-center gap-3.5 rounded-xl border bg-surface p-3.5 shadow-card transition-colors hover:border-forest-700/40 hover:bg-forest-50/40 sm:p-4',
          b.needsYourAnswer ? 'border-2 border-amber-400' : 'border-line',
          past && 'shadow-none',
        )}
      >
        <div className={cn('flex w-14 shrink-0 flex-col items-center rounded-lg py-2 text-center', past ? 'bg-paper text-ink-soft' : 'bg-primary text-primary-fg')}>
          <span className="font-display text-2xl leading-none font-bold tabular">{DAY.format(d)}</span>
          <span className={cn('mt-0.5 text-[12px] font-semibold', past ? 'text-ink-muted' : 'text-gold')}>{MONTH.format(d)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="font-semibold [overflow-wrap:anywhere]">{b.businessName}</p>
            <BookingStatusBadge status={b.status} label={b.statusLabel} />
            {b.needsYourAnswer && (
              <Badge variant="warning">
                <MessageCircleQuestion aria-hidden /> Needs your answer
              </Badge>
            )}
          </div>
          <p className="mt-0.5 text-sm text-ink">
            {formatWhen(b.startsAt)} <span className="text-ink-muted">({formatTimeRange(b.startsAt, b.endsAt)})</span>
          </p>
          <p className="truncate text-[13px] text-ink-soft">{b.servicesSummary}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-ink-muted">
            <span className="inline-flex items-center gap-1">
              {house ? <Car className="size-3.5" aria-hidden /> : <Store className="size-3.5" aria-hidden />}
              {house ? 'House call' : 'At the shop'}
            </span>
            <span>{b.staffName ?? 'Any barber'}</span>
            <span className="font-mono">{b.reference}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Money cents={b.totalCents} className="font-semibold" />
          <ChevronRight className="size-5 text-ink-muted" aria-hidden />
        </div>
      </Link>
    </li>
  )
}

/** /c — the signed-in customer's bookings at every shop, upcoming first. */
export function MyBookingsPage() {
  const q = useCustomerBookings()
  const account = useCustomerAccount()
  const split = useMemo(() => splitCustomerBookings(q.data ?? [], Date.now()), [q.data])
  const waiting = split.upcoming.filter((b) => b.needsYourAnswer).length

  useEffect(() => {
    document.title = 'My bookings | KasiFlow SA'
  }, [])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CustomerHeader
        title="My bookings"
        description={account.data ? <span className="[overflow-wrap:anywhere]">Your bookings at every shop. Signed in as {account.data.verifiedContact}.</span> : 'Your bookings at every shop.'}
       
        actions={
          (q.data?.length ?? 0) > 0 && (
          <Button asChild variant="outline">
            <Link to="/c/shops">
              <Search /> Find a barber
            </Link>
          </Button>
          )
        }
      />
      {waiting > 0 && (
        <p role="status" className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-medium text-amber-950">
          {waiting === 1 ? 'One booking needs your answer.' : `${waiting} bookings need your answer.`} Open it to accept or decline the new time.
        </p>
      )}
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load your bookings" />
      ) : (q.data?.length ?? 0) === 0 ? (
        <EmptyState
          icon={Scissors}
          title="No bookings yet"
          description="Find a shop to see its prices, barbers and their work, then book a time. You can also scan the QR code at your barber."
          action={
            <Button asChild size="lg">
              <Link to="/c/shops">
                <Search /> Find a barber
              </Link>
            </Button>
          }
        />
      ) : (
        <>
          <section aria-labelledby="up-h">
            <h2 id="up-h" className="mb-3 flex items-center gap-2 text-lg font-bold">
              <CalendarDays className="size-4 text-forest-800" aria-hidden /> Upcoming
            </h2>
            {split.upcoming.length === 0 ? (
              <p className="rounded-xl border border-dashed border-line-strong bg-surface/60 px-4 py-5 text-sm text-ink-muted">
                Nothing coming up.{' '}
                <Link to="/c/shops" className="font-semibold text-forest-800 hover:underline">
                  Book your next cut
                </Link>
              </p>
            ) : (
              <ul className="space-y-2.5">
                {split.upcoming.map((b) => (
                  <Row key={b.reference} b={b} />
                ))}
              </ul>
            )}
          </section>
          {split.past.length > 0 && (
            <section aria-labelledby="past-h">
              <h2 id="past-h" className="mb-3 text-lg font-bold text-ink-soft">
                Past and cancelled
              </h2>
              <ul className="space-y-2.5">
                {split.past.map((b) => (
                  <Row key={b.reference} b={b} past />
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  )
}
