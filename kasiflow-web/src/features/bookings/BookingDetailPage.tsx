import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, BadgeCheck, Car, Clock, HandCoins, MapPin, Pencil, Phone, Receipt, SearchX, Store, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Callout } from '@/components/shared/Callout'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { Money } from '@/components/shared/Money'
import { ReasonDialog } from '@/components/shared/ReasonDialog'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { BookingStatusBadge } from '@/components/shared/StatusBadges'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDate, formatDateTime } from '@/lib/format'
import { bookingButtons, durationLabel, eventLabel, formatTimeRange, formatWhen, groupByPerson, locationLabel } from '@/lib/barbershop'
import { PAYMENT_METHODS, PAYMENT_STATUS } from '@/lib/labels'
import { useAccess } from '@/features/access/useAccess'
import type { BookingAction, BookingDetailDto } from '@/types/barbershop'
import type { PaymentStatus } from '@/types/api'
import { useBooking, useBookingAction } from './api'
import { CompleteDialog, ConfirmBookingDialog, HouseCallDialog, ProposeDialog, TripExpenseDialog } from './BookingDialogs'
import { SafetyPanel } from '@/features/safety/SafetyPanel'
import { CustomerAccountCard } from '@/features/safety/CustomerAccountCard'
import { VisitMap } from '@/features/map/VisitMap'

type Open = BookingAction | 'house_call' | 'trip' | null

const PARAM_ACTION: Record<string, BookingAction> = {
  confirm: 'confirm',
  complete: 'complete',
  propose: 'propose_reschedule',
}

function HouseCallCard({ b, onEdit, onTrip, canEdit }: { b: BookingDetailDto; onEdit: () => void; onTrip: () => void; canEdit: boolean }) {
  const hc = b.houseCall
  if (!hc) return null
  const e = hc.economics
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Car className="size-5 text-forest-800" aria-hidden /> House call
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {hc.addressVisible ? (
          <div className="flex gap-2 text-sm">
            <MapPin className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <p className="font-medium">{[hc.addressLine, hc.suburb, hc.town].filter(Boolean).join(', ') || 'No address recorded'}</p>
              {hc.accessNotes && <p className="text-ink-muted">{hc.accessNotes}</p>}
            </div>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">{hc.town ? `${hc.town} · ` : ''}The address is visible to the assigned barber and managers only.</p>
        )}
        {hc.addressVisible && hc.latitude != null && hc.longitude != null && (
          <VisitMap address={{ lat: hc.latitude, lng: hc.longitude }} title={`Map of the visit address for ${b.summary.reference}`} />
        )}
        <p className="text-sm">
          <span className="text-ink-muted">Distance: </span>
          {hc.distanceLabel}
        </p>
        {e && (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-[13px] text-ink-muted">Revenue</dt>
              <dd className="font-semibold">
                <Money cents={e.revenueCents} />
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-ink-muted">Estimated costs</dt>
              <dd>{e.estimatedCostsCents == null ? 'Not estimated' : <Money cents={e.estimatedCostsCents} />}</dd>
            </div>
            <div>
              <dt className="text-[13px] text-ink-muted">Actual costs recorded</dt>
              <dd>
                <Money cents={e.actualCostsCents} />
                {!e.hasActualCosts && <span className="block text-[12px] text-ink-muted">none recorded yet</span>}
              </dd>
            </div>
            <div>
              <dt className="text-[13px] text-ink-muted">Contribution</dt>
              <dd className="font-semibold">
                {e.hasActualCosts ? (
                  <>
                    <Money cents={e.actualContributionCents} tone="auto" /> <span className="text-[12px] font-normal text-ink-muted">actual</span>
                  </>
                ) : e.estimatedContributionCents != null ? (
                  <>
                    <Money cents={e.estimatedContributionCents} tone="auto" /> <span className="text-[12px] font-normal text-ink-muted">estimated</span>
                  </>
                ) : (
                  '—'
                )}
              </dd>
            </div>
          </dl>
        )}
        {e && <p className="text-[12px] leading-snug text-ink-muted">{e.caveat}</p>}
        {canEdit && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={onEdit}>
              <Pencil /> Distance & estimates
            </Button>
            <Button size="sm" variant="outline" onClick={onTrip}>
              <Receipt /> Add trip expense
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function BookingDetailPage() {
  const { id } = useParams()
  const [params, setParams] = useSearchParams()
  const q = useBooking(id)
  const act = useBookingAction()
  const { can } = useAccess()
  const [open, setOpen] = useState<Open>(null)

  // Deep links from lists (?action=complete|propose|confirm) open the matching dialog once.
  const wanted = params.get('action')
  useEffect(() => {
    if (!wanted || !q.data) return
    const a = PARAM_ACTION[wanted]
    if (a && q.data.allowedActions.includes(a)) setOpen(a)
    const next = new URLSearchParams(params)
    next.delete('action')
    setParams(next, { replace: true })
  }, [wanted, q.data, params, setParams])

  const back = (
    <Link to="/bookings" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-forest-800 hover:underline">
      <ArrowLeft className="size-4" aria-hidden /> Bookings
    </Link>
  )
  if (q.isLoading)
    return (
      <div>
        {back}
        <Skeleton className="h-56" />
      </div>
    )
  if (q.isError || !q.data)
    return (
      <div>
        {back}
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <EmptyState icon={SearchX} title="Booking not found" description="It may belong to another business or branch, or the link is wrong." />
        ) : (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        )}
      </div>
    )

  const b = q.data
  const s = b.summary
  const buttons = bookingButtons(b.allowedActions)
  const remaining = Math.max(0, s.totalCents - s.paidCents)
  const manage = b.allowedActions.length > 0 || can('manageBookings')

  const simple = (kind: 'accept-proposal' | 'reject-proposal', ok: string) =>
    act.mutate(
      { id: s.id, m: { kind } },
      {
        onSuccess: () => toast.success(ok),
        onError: (e) => toast.error('Could not update', { description: errorMessage(e) }),
      },
    )

  const onAction = (a: BookingAction) => {
    if (a === 'accept_proposal') return simple('accept-proposal', 'Customer’s new time accepted')
    if (a === 'reject_proposal') return simple('reject-proposal', 'Customer’s request rejected; the original time stands')
    setOpen(a)
  }

  return (
    <div className="max-w-5xl">
      {back}
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold">{s.customerName}</h1>
            <BookingStatusBadge status={s.status} label={s.statusLabel} />
            {b.offDutyOverride && <Badge variant="warning">Approved exception</Badge>}
          </div>
          <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px] text-ink-soft">
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-4" aria-hidden /> {formatWhen(s.startsAt)} ({formatTimeRange(s.startsAt, s.endsAt)})
            </span>
            <span>{s.staffName ?? 'No barber assigned'}</span>
            <span className="inline-flex items-center gap-1.5">
              {s.locationType === 'house_call' ? <Car className="size-4" aria-hidden /> : <Store className="size-4" aria-hidden />}
              {locationLabel(s.locationType)}
            </span>
          </p>
          <p className="mt-1 font-mono text-[13px] text-ink-muted">
            {s.reference} · booked {b.source === 'public' ? 'online by the customer' : 'by the team'}
          </p>
        </div>
        {buttons.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {buttons.map((btn) => (
              <Button
                key={btn.action}
                variant={btn.variant}
                size="lg"
                className="h-11"
                loading={act.isPending && (btn.action === 'accept_proposal' || btn.action === 'reject_proposal')}
                onClick={() => onAction(btn.action)}
              >
                {btn.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      {s.status === 'reschedule_proposed' && s.proposedStartsAt && (
        <Callout
          tone="warning"
          className="mb-5"
          title={s.proposedBy === 'customer' ? 'The customer asked for another time' : 'Waiting for the customer to answer your proposal'}
        >
          Proposed: <strong>{formatWhen(s.proposedStartsAt)}</strong>
          {b.proposedTravelFeeCents != null && (
            <>
              {' '}
              · travel fee <Money cents={b.proposedTravelFeeCents} />
            </>
          )}
          {b.proposalNote && <span className="block">“{b.proposalNote}”</span>}
        </Callout>
      )}
      {b.cancelReason && (
        <Callout tone="neutral" className="mb-5" title="Cancelled">
          {b.cancelReason}
        </Callout>
      )}
      {b.overrideReason && (
        <Callout tone="info" className="mb-5" title="Confirmed as an approved exception">
          {b.overrideReason}
        </Callout>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="min-w-0 space-y-5 lg:col-span-3">
          {s.locationType === 'house_call' && s.status !== 'requested' && s.status !== 'cancelled' && <SafetyPanel bookingId={s.id} address={b.houseCall?.addressVisible && b.houseCall.latitude != null && b.houseCall.longitude != null ? { lat: b.houseCall.latitude, lng: b.houseCall.longitude } : null} />}
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                Services{' '}
                {s.peopleCount > 1 && (
                  <Badge variant="outline">
                    <Users aria-hidden /> {s.peopleCount} people
                  </Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {groupByPerson(b.items).map((g) => (
                <div key={g.person}>
                  {b.items.length > 1 && <p className="mb-1 text-[13px] font-semibold text-ink-muted">{g.person}</p>}
                  <ul className="divide-y divide-line rounded-md border border-line">
                    {g.items.map((it) => (
                      <li key={it.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                        <span className="min-w-0">
                          {it.serviceName} <span className="text-[12px] text-ink-muted">· {durationLabel(it.durationMinutes)}</span>
                        </span>
                        <Money cents={it.unitPriceCents} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <dl className="space-y-1.5 border-t border-line pt-3 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Services</dt>
                  <dd>
                    <Money cents={b.servicesTotalCents} />
                  </dd>
                </div>
                {(b.travelFeeCents > 0 || s.locationType === 'house_call') && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Travel fee</dt>
                    <dd>
                      <Money cents={b.travelFeeCents} />
                    </dd>
                  </div>
                )}
                {b.discountCents > 0 && (
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Discount</dt>
                    <dd>
                      −<Money cents={b.discountCents} />
                    </dd>
                  </div>
                )}
                <div className="flex justify-between text-base font-semibold">
                  <dt>Total</dt>
                  <dd>
                    <Money cents={s.totalCents} />
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Paid</dt>
                  <dd>
                    <Money cents={s.paidCents} />
                  </dd>
                </div>
                {s.status === 'completed' && remaining > 0 && (
                  <div className="flex justify-between text-amber-800">
                    <dt>{b.debtIds.length ? 'Still owed (customer debt)' : 'Not paid'}</dt>
                    <dd>
                      <Money cents={remaining} />
                    </dd>
                  </div>
                )}
              </dl>
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Payments</CardTitle>
              <CardDescription>Payments recorded against this visit.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {b.payments.length === 0 ? (
                <p className="text-sm text-ink-muted">No payments recorded.</p>
              ) : (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {b.payments.map((p) => (
                    <li key={p.transactionId} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0">
                        <Link to={`/transactions/${p.transactionId}`} className="font-medium text-forest-800 hover:underline">
                          {PAYMENT_METHODS[p.paymentMethod] ?? p.paymentMethod}
                        </Link>
                        <span className="block text-[12px] text-ink-muted">
                          {formatDate(p.date)} · {PAYMENT_STATUS[p.paymentStatus as PaymentStatus] ?? p.paymentStatus}
                        </span>
                      </span>
                      <Money cents={p.amountCents} className="font-semibold" />
                    </li>
                  ))}
                </ul>
              )}
              {b.debtIds.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {b.debtIds.map((d) => (
                    <Button key={d} asChild size="sm" variant="outline">
                      <Link to={`/debts/${d}`}>
                        <HandCoins /> Customer debt for this visit
                      </Link>
                    </Button>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>History</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="relative space-y-4 border-l border-line pl-5">
                {b.events.map((e, i) => (
                  <li key={i} className="relative">
                    <span className="absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-white bg-forest-700" aria-hidden />
                    <p className="text-sm font-medium">
                      {eventLabel(e.event)}{' '}
                      <span className="font-normal text-ink-muted">
                        · {e.actorKind === 'customer' ? 'customer' : e.actorKind === 'staff' ? 'team' : e.actorKind}
                      </span>
                    </p>
                    <p className="text-[12px] text-ink-muted">{formatDateTime(e.at)}</p>
                    {e.note && <p className="mt-0.5 text-[13px] text-ink-soft">{e.note}</p>}
                  </li>
                ))}
              </ol>
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Customer</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm [overflow-wrap:anywhere]">
              <p className="font-medium">{s.customerName}</p>
              {b.customerPhone && (
                <a
                  href={`tel:${b.customerPhone.replace(/[^\d+]/g, '')}`}
                  className="inline-flex items-center gap-1.5 font-medium text-forest-800 hover:underline"
                >
                  <Phone className="size-4" aria-hidden /> {b.customerPhone}
                </a>
              )}
              {b.customerEmail && <p className="text-ink-soft">{b.customerEmail}</p>}
              {b.verifiedContact && (
                <p className="inline-flex items-center gap-1.5 text-[13px] text-emerald-900">
                  <BadgeCheck className="size-4 shrink-0" aria-hidden /> Verified with a one-time code: {b.verifiedContact}
                </p>
              )}
              {!b.customerPhone && !b.customerEmail && <p className="text-ink-muted">Contact details are visible to the assigned barber and managers.</p>}
              {b.customerNote && (
                <p className="rounded-md bg-paper px-3 py-2">
                  <span className="block text-[12px] text-ink-muted">Customer’s note</span>
                  {b.customerNote}
                </p>
              )}
              {b.internalNote && (
                <p className="rounded-md bg-paper px-3 py-2">
                  <span className="block text-[12px] text-ink-muted">Team note</span>
                  {b.internalNote}
                </p>
              )}
            </CardContent>
          </Card>
          <HouseCallCard b={b} canEdit={manage} onEdit={() => setOpen('house_call')} onTrip={() => setOpen('trip')} />
          {b.customerAccountId && <CustomerAccountCard bookingId={s.id} canAddNote={manage || can('workOwnBookings')} />}
        </div>
      </div>

      <ConfirmBookingDialog b={b} open={open === 'confirm'} onOpenChange={(o) => setOpen(o ? 'confirm' : null)} />
      <ProposeDialog b={b} open={open === 'propose_reschedule'} onOpenChange={(o) => setOpen(o ? 'propose_reschedule' : null)} />
      <CompleteDialog b={b} open={open === 'complete'} onOpenChange={(o) => setOpen(o ? 'complete' : null)} />
      <HouseCallDialog b={b} open={open === 'house_call'} onOpenChange={(o) => setOpen(o ? 'house_call' : null)} />
      <TripExpenseDialog b={b} open={open === 'trip'} onOpenChange={(o) => setOpen(o ? 'trip' : null)} />
      <ConfirmDialog
        open={open === 'no_show'}
        onOpenChange={(o) => setOpen(o ? 'no_show' : null)}
        title={`Mark ${s.customerName} as a no-show?`}
        description="Use this only if the customer did not arrive. It cannot be undone."
        confirmLabel="Mark as no-show"
        destructive
        pending={act.isPending}
        onConfirm={() =>
          act.mutate(
            { id: s.id, m: { kind: 'no-show' } },
            {
              onSuccess: () => {
                toast.success('Marked as no-show')
                setOpen(null)
              },
              onError: (e) =>
                toast.error('Could not update', {
                  description: errorMessage(e),
                }),
            },
          )
        }
      />
      <ReasonDialog
        open={open === 'cancel'}
        onOpenChange={(o) => setOpen(o ? 'cancel' : null)}
        title="Cancel this booking?"
        description="The customer’s status page will show it as cancelled. The history is kept."
        confirmLabel="Cancel booking"
        reasonLabel="Reason"
        pending={act.isPending}
        onConfirm={(reason) =>
          act.mutate(
            { id: s.id, m: { kind: 'cancel', reason } },
            {
              onSuccess: () => {
                toast.success('Booking cancelled')
                setOpen(null)
              },
              onError: (e) =>
                toast.error('Could not cancel', {
                  description: errorMessage(e),
                }),
            },
          )
        }
      />
    </div>
  )
}
