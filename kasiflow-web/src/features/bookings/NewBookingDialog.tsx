import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { Money } from '@/components/shared/Money'
import { DateStrip, SlotPicker } from '@/components/shared/SlotPicker'
import { ServicePeoplePicker, type PersonChoice } from '@/components/shared/ServicePeoplePicker'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { parseRandToCents, todayJhb } from '@/lib/format'
import { canOfferException, durationLabel, groupSlots, itemsFromPeople, type SlotGroup } from '@/lib/barbershop'
import { cn } from '@/lib/utils'
import { useAccess } from '@/features/access/useAccess'
import { useServices, useTeam } from '@/features/team/api'
import type { BookingInput, LocationType } from '@/types/barbershop'
import { useAvailability, useBookingPolicy, useCreateBooking, useQuote } from './api'

function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

/** Front-desk booking: customer, services per person, barber or "any", in-shop or house call, a free time and a live quote. */
export function NewBookingDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate()
  const { role } = useAccess()
  const services = useServices(false, open)
  const team = useTeam(open)
  const policy = useBookingPolicy(open)
  const create = useCreateBooking()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [people, setPeople] = useState<PersonChoice[]>([{ label: '', serviceIds: [] }])
  const [staffId, setStaffId] = useState('')
  const [location, setLocation] = useState<LocationType>('in_shop')
  const [addr, setAddr] = useState({ addressLine: '', suburb: '', town: '', accessNotes: '', distanceKm: '' })
  const [discount, setDiscount] = useState('')
  const [date, setDate] = useState(todayJhb())
  const [slot, setSlot] = useState<SlotGroup | null>(null)
  const [confirmNow, setConfirmNow] = useState(true)
  const [customerNote, setCustomerNote] = useState('')
  const [internalNote, setInternalNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [conflict, setConflict] = useState<string>()
  const [exception, setException] = useState(false)
  const [exceptionReason, setExceptionReason] = useState('')

  useEffect(() => {
    if (open) {
      setName('')
      setPhone('')
      setEmail('')
      setPeople([{ label: '', serviceIds: [] }])
      setStaffId('')
      setLocation('in_shop')
      setAddr({ addressLine: '', suburb: '', town: '', accessNotes: '', distanceKm: '' })
      setDiscount('')
      setDate(todayJhb())
      setSlot(null)
      setConfirmNow(true)
      setCustomerNote('')
      setInternalNote('')
      setErrors({})
      setConflict(undefined)
      setException(false)
      setExceptionReason('')
    }
  }, [open])

  const items = useMemo(() => itemsFromPeople(people), [people])
  const serviceIds = useMemo(() => items.map((i) => i.serviceId), [items])
  const distanceKm = addr.distanceKm.trim() ? Number(addr.distanceKm.replace(',', '.')) : null
  const discountCents = discount.trim() ? parseRandToCents(discount) : 0
  const bookable = (team.data ?? []).filter((t) => t.isActive && t.isBookable && (location === 'in_shop' || t.acceptsHouseCalls))

  const quoteInput: BookingInput | null = useDebounced(
    items.length
      ? {
          items,
          staffId: staffId || null,
          locationType: location,
          houseCall: location === 'house_call' ? { distanceKm: Number.isFinite(distanceKm) ? distanceKm : null } : null,
          discountCents: discountCents ?? 0,
        }
      : null,
  )
  const quote = useQuote(open ? quoteInput : null)
  const avail = useAvailability({ date, serviceIds, staffId: staffId || null, locationType: location }, open)
  const groups = useMemo(() => groupSlots(avail.data?.slots ?? [], staffId || null), [avail.data, staffId])

  // A chosen time stops being valid when what it depends on changes.
  const slotKey = `${date}|${staffId}|${location}|${serviceIds.join(',')}`
  useEffect(() => setSlot(null), [slotKey])

  const submit = () => {
    const e: Record<string, string> = {}
    if (!name.trim()) e.customerName = 'Enter the customer’s name.'
    if (items.length === 0) e.items = 'Choose at least one service.'
    if (!slot) e.startsAt = 'Choose a time.'
    if (location === 'house_call' && !addr.addressLine.trim() && !addr.town.trim()) e.houseCall = 'Enter the address for the house call.'
    if (discountCents === null) e.discountCents = 'Enter a discount like 20 or 20.50.'
    if (exception && exceptionReason.trim().length < 3) e.overrideReason = 'Say why this exception is approved.'
    setErrors(e)
    if (Object.keys(e).length || !slot) return
    const input: BookingInput = {
      items,
      staffId: staffId || (slot.staff.length === 1 ? slot.staff[0].staffId : null),
      startsAt: slot.startsAt,
      locationType: location,
      houseCall:
        location === 'house_call'
          ? {
              addressLine: addr.addressLine.trim() || null,
              suburb: addr.suburb.trim() || null,
              town: addr.town.trim() || null,
              accessNotes: addr.accessNotes.trim() || null,
              distanceKm: Number.isFinite(distanceKm) ? distanceKm : null,
            }
          : null,
      customerName: name.trim(),
      customerPhone: phone.trim() || null,
      customerEmail: email.trim() || null,
      customerNote: customerNote.trim() || null,
      internalNote: internalNote.trim() || null,
      discountCents: discountCents || null,
      confirm: confirmNow,
      offDutyOverride: exception,
      overrideReason: exception ? exceptionReason.trim() : null,
    }
    create.mutate(input, {
      onSuccess: (b) => {
        toast.success(`Booking ${b.summary.reference} ${b.summary.status === 'confirmed' ? 'confirmed' : 'saved as a request'}`)
        onOpenChange(false)
        navigate(`/bookings/${b.summary.id}`)
      },
      onError: (err) => {
        if (err instanceof ApiError && (err.status === 409 || err.status === 403)) return setConflict(err.detail ?? err.userMessage)
        if (err instanceof ApiError && Object.keys(err.errors).length) {
          const fe = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]]))
          setErrors(fe)
          toast.error('Check the booking', { description: Object.values(fe)[0] })
          return
        }
        toast.error('Could not save the booking', { description: errorMessage(err) })
      },
    })
  }

  const q = quote.data
  const offerException = canOfferException(role, conflict, policy.data?.allowOffDutyOverride)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>Prices come from your service list. The time is checked again when you save.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-6">
          <section className="space-y-3" aria-labelledby="nb-cust">
            <h3 id="nb-cust" className="font-sans text-sm font-semibold">Customer</h3>
            <Field id="nb-name" label="Name" error={errors.customerName}>
              <Input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} autoComplete="off" />
            </Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="nb-phone" label="Phone" optional error={errors.customerPhone}>
                <Input type="tel" value={phone} maxLength={30} onChange={(e) => setPhone(e.target.value)} />
              </Field>
              <Field id="nb-email" label="Email" optional error={errors.customerEmail}>
                <Input type="email" value={email} maxLength={160} onChange={(e) => setEmail(e.target.value)} />
              </Field>
            </div>
          </section>

          <section className="space-y-3" aria-labelledby="nb-where">
            <h3 id="nb-where" className="font-sans text-sm font-semibold">Where</h3>
            <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Location">
              {(['in_shop', 'house_call'] as const).map((l) => (
                <button
                  key={l}
                  type="button"
                  role="radio"
                  aria-checked={location === l}
                  disabled={l === 'house_call' && policy.data?.houseCallsEnabled === false}
                  onClick={() => setLocation(l)}
                  className={cn(
                    'h-11 cursor-pointer rounded-md border text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50',
                    location === l ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong bg-surface hover:bg-forest-50',
                  )}
                >
                  {l === 'in_shop' ? 'In the shop' : 'House call'}
                </button>
              ))}
            </div>
            {policy.data?.houseCallsEnabled === false && <p className="text-[13px] text-ink-muted">House calls are switched off in Settings.</p>}
            {location === 'house_call' && (
              <div className="grid gap-3 rounded-md border border-line p-3 sm:grid-cols-2">
                <Field id="nb-addr" label="Street address" className="sm:col-span-2" error={errors.houseCall}>
                  <Input value={addr.addressLine} maxLength={200} onChange={(e) => setAddr({ ...addr, addressLine: e.target.value })} />
                </Field>
                <Field id="nb-suburb" label="Suburb / section" optional>
                  <Input value={addr.suburb} maxLength={80} onChange={(e) => setAddr({ ...addr, suburb: e.target.value })} />
                </Field>
                <Field id="nb-town" label="Town" optional>
                  <Input value={addr.town} maxLength={80} onChange={(e) => setAddr({ ...addr, town: e.target.value })} />
                </Field>
                <Field id="nb-access" label="Access notes" optional>
                  <Input value={addr.accessNotes} maxLength={300} onChange={(e) => setAddr({ ...addr, accessNotes: e.target.value })} placeholder="Gate, landmark…" />
                </Field>
                <Field id="nb-km" label="Distance (km)" optional hint="Entered by you; KasiFlow does not calculate it." error={errors['houseCall.distanceKm']}>
                  <Input inputMode="decimal" value={addr.distanceKm} onChange={(e) => setAddr({ ...addr, distanceKm: e.target.value })} />
                </Field>
                {policy.data && <p className="text-[13px] text-ink-muted sm:col-span-2">{policy.data.travelFeeDescription}</p>}
              </div>
            )}
          </section>

          <section className="space-y-3" aria-labelledby="nb-svc">
            <h3 id="nb-svc" className="font-sans text-sm font-semibold">Services</h3>
            {services.isLoading ? (
              <p className="text-sm text-ink-muted">Loading services…</p>
            ) : services.data?.length ? (
              <ServicePeoplePicker services={services.data} people={people} onChange={setPeople} houseCall={location === 'house_call'} />
            ) : (
              <p className="text-sm text-ink-muted">No active services yet. Add them under Services & prices.</p>
            )}
            {errors.items && <p role="alert" className="text-[13px] font-medium text-red-700">{errors.items}</p>}
          </section>

          <section className="space-y-3" aria-labelledby="nb-when">
            <h3 id="nb-when" className="font-sans text-sm font-semibold">Barber and time</h3>
            <div>
              <Label htmlFor="nb-staff">Barber</Label>
              <NativeSelect id="nb-staff" className="mt-1.5" value={staffId} onChange={(e) => setStaffId(e.target.value)}>
                <option value="">Any barber</option>
                {bookable.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.displayName} — {t.status.label}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <DateStrip value={date} onChange={setDate} id="nb-date" maxDays={policy.data?.bookingHorizonDays ?? 60} />
            {serviceIds.length === 0 ? (
              <p className="text-[13px] text-ink-muted">Choose services first to see free times.</p>
            ) : (
              <SlotPicker groups={groups} loading={avail.isLoading} error={avail.error} notes={avail.data?.notes} value={slot?.startsAt ?? null} onChange={setSlot} showStaff={!staffId} />
            )}
            {slot && !staffId && slot.staff.length > 1 && (
              <p className="text-[13px] text-ink-muted">Free at {slot.time}: {slot.staff.map((s) => s.staffName).join(', ')}. KasiFlow assigns one when you save.</p>
            )}
            {errors.startsAt && <p role="alert" className="text-[13px] font-medium text-red-700">{errors.startsAt}</p>}
          </section>

          <section className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field id="nb-discount" label="Discount" optional error={errors.discountCents}>
                <MoneyInput value={discount} onChange={(e) => setDiscount(e.target.value)} />
              </Field>
            </div>
            <Field id="nb-cnote" label="Customer’s note" optional>
              <Textarea rows={2} maxLength={500} value={customerNote} onChange={(e) => setCustomerNote(e.target.value)} />
            </Field>
            <Field id="nb-inote" label="Team note (not shown to the customer)" optional>
              <Textarea rows={2} maxLength={500} value={internalNote} onChange={(e) => setInternalNote(e.target.value)} />
            </Field>
            <label className="flex items-start gap-2.5 text-sm">
              <Checkbox className="mt-0.5" checked={confirmNow} onChange={(e) => setConfirmNow(e.target.checked)} />
              <span>
                <strong>Confirm now.</strong> Untick to save it as a request that someone confirms later.
              </span>
            </label>
          </section>

          <section aria-live="polite" className="rounded-lg border border-forest-800/20 bg-forest-50 p-4">
            <h3 className="font-sans text-sm font-semibold">Quote</h3>
            {!items.length ? (
              <p className="mt-1 text-sm text-ink-muted">Choose services to see the price.</p>
            ) : quote.isError ? (
              <p className="mt-1 text-sm text-red-800">{errorMessage(quote.error)}</p>
            ) : q ? (
              <dl className={cn('mt-2 space-y-1 text-sm', quote.isFetching && 'opacity-60')}>
                <div className="flex justify-between">
                  <dt>Services</dt>
                  <dd><Money cents={q.servicesTotalCents} /></dd>
                </div>
                {location === 'house_call' && (
                  <div className="flex justify-between">
                    <dt>Travel fee{!q.travelFeeFinal && ' (estimate)'}</dt>
                    <dd><Money cents={q.travelFeeCents} /></dd>
                  </div>
                )}
                {q.discountCents > 0 && (
                  <div className="flex justify-between">
                    <dt>Discount</dt>
                    <dd>−<Money cents={q.discountCents} /></dd>
                  </div>
                )}
                <div className="flex justify-between border-t border-forest-800/20 pt-1 text-base font-semibold">
                  <dt>Total</dt>
                  <dd><Money cents={q.totalCents} /></dd>
                </div>
                <div className="flex justify-between text-ink-muted">
                  <dt>Time needed</dt>
                  <dd>{durationLabel(q.durationMinutes)}</dd>
                </div>
                {q.travelFeeExplanation && <p className="pt-1 text-[13px] text-ink-soft">{q.travelFeeExplanation}</p>}
                {q.outsideServiceArea && <p className="pt-1 text-[13px] font-medium text-amber-800">This address is outside the service area.</p>}
              </dl>
            ) : (
              <p className="mt-1 text-sm text-ink-muted">Working out the price…</p>
            )}
          </section>

          {conflict && (
            <div role="alert" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <p>{conflict}</p>
              {offerException && (
                <>
                  <label className="flex items-start gap-2.5">
                    <Checkbox className="mt-0.5" checked={exception} onChange={(e) => setException(e.target.checked)} />
                    <span>
                      <strong>Approve an exception</strong> — the barber agreed to work this time.
                    </span>
                  </label>
                  {exception && (
                    <Field id="nb-exc" label="Reason" error={errors.overrideReason}>
                      <Input maxLength={300} value={exceptionReason} onChange={(e) => setExceptionReason(e.target.value)} />
                    </Field>
                  )}
                </>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={create.isPending} onClick={submit}>
            {confirmNow ? 'Save and confirm' : 'Save as request'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
