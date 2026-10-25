import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { CalendarClock, Car, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Money } from '@/components/shared/Money'
import { DateStrip, SlotPicker } from '@/components/shared/SlotPicker'
import { BookingStatusBadge } from '@/components/shared/StatusBadges'
import { todayJhb } from '@/lib/format'
import { formatTimeRange, formatWhen, groupSlots, serviceIdsFromLabels, type SlotGroup } from '@/lib/barbershop'
import type { PublicBookingOp, PublicBookingStatusDto } from '@/types/barbershop'
import { usePublicAvailability, usePublicBookingInfo } from './api'

export interface StatusActInput {
  startsAt?: string | null
  note?: string | null
}

/** Runs one customer action. Resolves when it succeeded (the caller shows toasts and refreshes). */
export type StatusAct = (op: PublicBookingOp, input: StatusActInput, ok: string) => Promise<boolean>

function RequestTime({ slug, booking, act, pending, onDone }: { slug: string; booking: PublicBookingStatusDto; act: StatusAct; pending: boolean; onDone: () => void }) {
  const info = usePublicBookingInfo(slug, true)
  const serviceIds = useMemo(
    () => (booking.serviceIds?.length ? booking.serviceIds : serviceIdsFromLabels(booking.services, info.data?.services ?? [])),
    [booking.serviceIds, booking.services, info.data],
  )
  const staffId = booking.staffId ?? info.data?.staff.find((s) => s.displayName === booking.staffName)?.id ?? null
  const [date, setDate] = useState(todayJhb())
  const [slot, setSlot] = useState<SlotGroup | null>(null)
  const [note, setNote] = useState('')
  const avail = usePublicAvailability(slug, { date, serviceIds, staffId, locationType: booking.locationType }, !!info.data && serviceIds.length > 0)
  const groups = useMemo(() => groupSlots(avail.data?.slots ?? [], staffId), [avail.data, staffId])
  useEffect(() => setSlot(null), [date])
  if (info.isLoading) return <Skeleton className="h-32" />
  if (info.data && serviceIds.length === 0)
    return <p className="text-sm text-ink-muted">These services can no longer be booked online. Contact the business to change the time.</p>
  return (
    <div className="space-y-3">
      <DateStrip value={date} onChange={setDate} id="st-date" maxDays={info.data?.horizonDays ?? 30} />
      <SlotPicker groups={groups} loading={avail.isLoading} error={avail.error} notes={avail.data?.notes} value={slot?.startsAt ?? null} onChange={setSlot} />
      <Field id="st-note" label="Note to the business" optional>
        <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <Button
        disabled={!slot}
        loading={pending}
        className="max-w-full whitespace-normal"
        onClick={async () => {
          if (!slot) return
          if (await act('reschedule', { startsAt: slot.startsAt, note: note.trim() || null }, 'Request sent to the business')) onDone()
        }}
      >
        Ask for {slot ? formatWhen(slot.startsAt) : 'this time'}
      </Button>
    </div>
  )
}

/**
 * A booking as the customer sees it (public token link or the signed-in "My bookings"): status, time, services,
 * money, an answer to a proposed new time, and change / cancel.
 */
export function BookingStatusView({
  booking: b,
  slug,
  act,
  pendingOp,
  footer,
}: {
  booking: PublicBookingStatusDto
  /** Needed to look up free times for "Request another time"; without it the customer is asked to contact the shop. */
  slug: string | null
  act: StatusAct
  pendingOp: PublicBookingOp | null
  footer?: ReactNode
}) {
  const [cancelOpen, setCancelOpen] = useState(false)
  const [moving, setMoving] = useState(false)

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-line bg-surface p-5 shadow-card sm:p-6">
        <p className="text-sm font-semibold text-ochre">{b.businessName}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <h1 className="font-mono text-2xl font-bold">{b.reference}</h1>
          <BookingStatusBadge status={b.status} label={b.statusLabel} className="px-2.5 py-1 text-[13px]" />
        </div>
        <p className="mt-3 text-[15px] text-ink">{b.message}</p>
        <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-ink-muted">When</dt>
            <dd className="font-semibold">
              {formatWhen(b.startsAt)} <span className="font-normal text-ink-muted">({formatTimeRange(b.startsAt, b.endsAt)})</span>
            </dd>
          </div>
          <div>
            <dt className="text-ink-muted">Barber</dt>
            <dd className="font-semibold">{b.staffName ?? 'The first free barber'}</dd>
          </div>
          <div>
            <dt className="text-ink-muted">Where</dt>
            <dd className="inline-flex items-center gap-1.5 font-semibold">
              {b.locationType === 'house_call' ? <Car className="size-4" aria-hidden /> : <Store className="size-4" aria-hidden />}
              {b.locationType === 'house_call' ? 'At your place' : 'At the shop'}
            </dd>
          </div>
        </dl>
        <ul className="mt-4 divide-y divide-line rounded-md border border-line text-sm">
          {b.services.map((s, i) => (
            <li key={i} className="px-3 py-2">
              {s}
            </li>
          ))}
        </ul>
        <dl className="mt-3 space-y-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-ink-muted">Services</dt>
            <dd>
              <Money cents={b.servicesTotalCents} />
            </dd>
          </div>
          {(b.travelFeeCents > 0 || b.locationType === 'house_call') && (
            <div className="flex justify-between">
              <dt className="text-ink-muted">Travel fee</dt>
              <dd>
                <Money cents={b.travelFeeCents} />
              </dd>
            </div>
          )}
          <div className="flex justify-between text-base font-bold">
            <dt>Total</dt>
            <dd>
              <Money cents={b.totalCents} />
            </dd>
          </div>
        </dl>
      </div>

      {b.status === 'reschedule_proposed' && b.proposedStartsAt && (
        <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-5">
          <p className="flex items-center gap-2 font-semibold text-amber-950">
            <CalendarClock className="size-5 shrink-0" aria-hidden />
            {b.proposedBy === 'business' ? 'The business proposed a different time' : 'You asked for a different time'}
          </p>
          <p className="text-sm text-amber-950">
            New time: <strong>{formatWhen(b.proposedStartsAt)}</strong>
            {b.proposedTravelFeeCents != null && (
              <>
                {' '}
                · travel fee{' '}
                <strong>
                  <Money cents={b.proposedTravelFeeCents} />
                </strong>
              </>
            )}
          </p>
          {b.proposalNote && <p className="text-sm text-amber-950">“{b.proposalNote}”</p>}
          {b.allowedActions.includes('accept-proposal') && (
            <div className="flex flex-wrap gap-2">
              <Button size="lg" className="h-11" loading={pendingOp === 'accept-proposal'} disabled={!!pendingOp} onClick={() => void act('accept-proposal', {}, 'New time accepted')}>
                Accept new time
              </Button>
              <Button size="lg" variant="outline" className="h-11" loading={pendingOp === 'reject-proposal'} disabled={!!pendingOp} onClick={() => void act('reject-proposal', {}, 'Proposal declined')}>
                Decline
              </Button>
            </div>
          )}
        </div>
      )}

      {(b.allowedActions.includes('reschedule') || b.allowedActions.includes('cancel')) && (
        <div className="space-y-3 rounded-lg border border-line bg-surface p-5 shadow-card">
          <h2 className="font-sans text-base font-semibold">Need to change something?</h2>
          {b.allowedActions.includes('reschedule') &&
            (!slug ? (
              <p className="text-sm text-ink-muted">To move this booking, contact {b.businessName}.</p>
            ) : moving ? (
              <RequestTime slug={slug} booking={b} act={act} pending={pendingOp === 'reschedule'} onDone={() => setMoving(false)} />
            ) : (
              <Button variant="outline" onClick={() => setMoving(true)}>
                Request another time
              </Button>
            ))}
          {b.allowedActions.includes('cancel') && (
            <div>
              <Button variant="ghost" className="text-red-700 hover:text-red-800" onClick={() => setCancelOpen(true)}>
                Cancel booking
              </Button>
            </div>
          )}
        </div>
      )}
      {footer}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this booking?"
        description="The business will see it as cancelled. You can book again later."
        confirmLabel="Cancel booking"
        cancelLabel="Keep booking"
        destructive
        pending={pendingOp === 'cancel'}
        onConfirm={async () => {
          if (await act('cancel', {}, 'Booking cancelled')) setCancelOpen(false)
        }}
      />
    </div>
  )
}
