import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { Money } from '@/components/shared/Money'
import { DateStrip, SlotPicker } from '@/components/shared/SlotPicker'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { addDays, centsToRandInput, formatZAR, parseRandToCents, todayJhb } from '@/lib/format'
import { canOfferException, formatWhen, groupSlots, jhbDate, type SlotGroup } from '@/lib/barbershop'
import { PAYMENT_METHODS, entries } from '@/lib/labels'
import { useAccess } from '@/features/access/useAccess'
import { useDebtPolicy } from '@/features/debts/api'
import { useCategories } from '@/features/transactions/api'
import type { PaymentMethod } from '@/types/api'
import type { BookingDetailDto } from '@/types/barbershop'
import { useAvailability, useBookingAction, useBookingPolicy } from './api'

interface DialogProps {
  b: BookingDetailDto
  open: boolean
  onOpenChange: (o: boolean) => void
}

function fieldErrors(err: unknown): Record<string, string> {
  if (!(err instanceof ApiError)) return {}
  return Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]]))
}

// ---------- Confirm (with approved exception) ----------
export function ConfirmBookingDialog({ b, open, onOpenChange }: DialogProps) {
  const { role, can } = useAccess()
  const act = useBookingAction()
  const policy = useBookingPolicy(open && can('manageSettings', 'manageBookings'))
  const [conflict, setConflict] = useState<string>()
  const [exception, setException] = useState(false)
  const [reason, setReason] = useState('')
  const [reasonError, setReasonError] = useState<string>()
  useEffect(() => {
    if (open) {
      setConflict(undefined)
      setException(false)
      setReason('')
      setReasonError(undefined)
    }
  }, [open])
  const offerException = canOfferException(role, conflict, policy.data?.allowOffDutyOverride)

  const submit = () => {
    if (exception && reason.trim().length < 3) {
      setReasonError('Say why this exception is approved.')
      return
    }
    act.mutate(
      { id: b.summary.id, m: { kind: 'confirm', input: exception ? { offDutyOverride: true, overrideReason: reason.trim() } : {} } },
      {
        onSuccess: () => {
          toast.success('Booking confirmed')
          onOpenChange(false)
        },
        onError: (e) => {
          if (e instanceof ApiError && (e.status === 409 || e.status === 403)) setConflict(e.detail ?? e.userMessage)
          else if (e instanceof ApiError && e.fieldError('overrideReason')) setReasonError(e.fieldError('overrideReason'))
          else toast.error('Could not confirm', { description: errorMessage(e) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Confirm {b.summary.reference}?</DialogTitle>
          <DialogDescription>
            {formatWhen(b.summary.startsAt)} with {b.summary.staffName ?? 'a barber'}. The customer is told it is confirmed.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {conflict && (
            <p role="alert" className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-950">
              {conflict}
            </p>
          )}
          {offerException && (
            <div className="space-y-2 rounded-md border border-line p-3">
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox className="mt-0.5" checked={exception} onChange={(e) => setException(e.target.checked)} />
                <span>
                  <strong>Approve an exception.</strong> I checked with the barber and they agreed to work this time.
                </span>
              </label>
              {exception && (
                <Field id="exc-reason" label="Reason for the exception" error={reasonError}>
                  <Input maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Ayanda agreed to come in early" />
                </Field>
              )}
            </div>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Not now
          </Button>
          <Button loading={act.isPending} onClick={submit}>
            {exception ? 'Confirm as exception' : 'Confirm booking'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Propose a new time ----------
export function ProposeDialog({ b, open, onOpenChange }: DialogProps) {
  const act = useBookingAction()
  const serviceIds = useMemo(() => b.items.map((i) => i.serviceId).filter((x): x is string => !!x), [b.items])
  const [date, setDate] = useState(() => jhbDate(b.summary.startsAt) >= todayJhb() ? jhbDate(b.summary.startsAt) : todayJhb())
  const [anyBarber, setAnyBarber] = useState(false)
  const [slot, setSlot] = useState<SlotGroup | null>(null)
  const [fee, setFee] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const house = b.summary.locationType === 'house_call'
  const avail = useAvailability({ date, serviceIds, staffId: anyBarber ? null : b.summary.staffId, locationType: b.summary.locationType }, open)
  const groups = useMemo(() => groupSlots(avail.data?.slots ?? [], anyBarber ? null : b.summary.staffId), [avail.data, anyBarber, b.summary.staffId])

  useEffect(() => {
    if (open) {
      setSlot(null)
      setFee(house ? centsToRandInput(b.travelFeeCents) : '')
      setNote('')
      setErrors({})
    }
  }, [open, house, b.travelFeeCents])

  const submit = () => {
    if (!slot) {
      setErrors({ startsAt: 'Choose a new time.' })
      return
    }
    const feeCents = house && fee.trim() ? parseRandToCents(fee) : null
    if (house && fee.trim() && feeCents === null) {
      setErrors({ travelFeeCents: 'Enter an amount like 120 or 120.50.' })
      return
    }
    const staffId = slot.staff.some((s) => s.staffId === b.summary.staffId) ? b.summary.staffId : slot.staff[0]?.staffId
    act.mutate(
      { id: b.summary.id, m: { kind: 'propose', input: { startsAt: slot.startsAt, staffId, travelFeeCents: feeCents, note: note.trim() || null } } },
      {
        onSuccess: () => {
          toast.success('New time proposed to the customer')
          onOpenChange(false)
        },
        onError: (e) => {
          const fe = fieldErrors(e)
          setErrors(fe)
          if (!Object.keys(fe).length) toast.error('Could not propose', { description: errorMessage(e) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>Propose a new time</DialogTitle>
          <DialogDescription>The customer must accept before the new time applies. Currently {formatWhen(b.summary.startsAt)}.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <DateStrip value={date} onChange={(d) => { setDate(d); setSlot(null) }} id="prop-date" />
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={anyBarber} onChange={(e) => { setAnyBarber(e.target.checked); setSlot(null) }} /> Show times for any barber
          </label>
          <SlotPicker groups={groups} loading={avail.isLoading} error={avail.error} notes={avail.data?.notes} value={slot?.startsAt ?? null} onChange={setSlot} showStaff={anyBarber} />
          {errors.startsAt && <p role="alert" className="text-[13px] font-medium text-red-700">{errors.startsAt}</p>}
          {house && (
            <Field id="prop-fee" label="Travel fee" optional hint="Only if the confirmed distance changes the fee. The customer sees it before accepting." error={errors.travelFeeCents}>
              <MoneyInput value={fee} onChange={(e) => setFee(e.target.value)} />
            </Field>
          )}
          <Field id="prop-note" label="Note to the customer" optional error={errors.note}>
            <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={act.isPending} onClick={submit}>
            Send proposal
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Complete the visit ----------
interface PayRow {
  amount: string
  method: PaymentMethod
}

export function CompleteDialog({ b, open, onOpenChange }: DialogProps) {
  const { can } = useAccess()
  const act = useBookingAction()
  const canPay = can('recordSales', 'takeBookingPayments')
  const canDebt = can('manageFinancials', 'recordDebtPayments')
  const policy = useDebtPolicy(open && can('viewFinancials', 'recordDebtPayments', 'configureDebtPolicy'))
  const due = Math.max(0, b.summary.totalCents - b.summary.paidCents)
  const [rows, setRows] = useState<PayRow[]>([])
  const [makeDebt, setMakeDebt] = useState(false)
  const [dueDate, setDueDate] = useState(addDays(todayJhb(), 7))
  const [disclosed, setDisclosed] = useState(false)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (open) {
      setRows(canPay && due > 0 ? [{ amount: centsToRandInput(due), method: 'cash' }] : [])
      setMakeDebt(false)
      setDueDate(addDays(todayJhb(), 7))
      setDisclosed(false)
      setNote('')
      setError(undefined)
    }
  }, [open, due, canPay])

  const parsed = rows.map((r) => parseRandToCents(r.amount))
  const paying = parsed.reduce<number>((s, c) => s + (c ?? 0), 0)
  const remaining = due - paying
  const terms = policy.data?.terms?.trim() ? policy.data.terms : null

  const submit = () => {
    if (parsed.some((c) => c === null || c <= 0)) return setError('Enter each payment amount (more than R0.00), or remove the row.')
    if (remaining < 0) return setError(`That is more than the ${formatZAR(due)} still due. Record tips separately.`)
    setError(undefined)
    act.mutate(
      {
        id: b.summary.id,
        m: {
          kind: 'complete',
          input: {
            payments: rows.map((r, i) => ({ amountCents: parsed[i] ?? 0, paymentMethod: r.method })),
            createDebtForRemainder: remaining > 0 && makeDebt,
            debtDueDate: remaining > 0 && makeDebt ? dueDate : null,
            chargeTermsDisclosed: remaining > 0 && makeDebt && !!terms && disclosed,
            note: note.trim() || null,
          },
        },
      },
      {
        onSuccess: () => {
          toast.success('Visit completed')
          onOpenChange(false)
        },
        onError: (e) => setError(errorMessage(e)),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>Complete {b.summary.reference}</DialogTitle>
          <DialogDescription>
            Total <strong>{formatZAR(b.summary.totalCents)}</strong>
            {b.summary.paidCents > 0 && <> · already paid {formatZAR(b.summary.paidCents)}</>} · still due <strong>{formatZAR(due)}</strong>.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {canPay ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">Payments taken now</legend>
              {rows.length === 0 && <p className="text-[13px] text-ink-muted">No payment recorded now.</p>}
              {rows.map((r, i) => (
                <div key={i} className="flex items-end gap-2">
                  <Field id={`pay-amt-${i}`} label={i === 0 ? 'Amount' : <span className="sr-only">Amount</span>} className="min-w-0 flex-1">
                    <MoneyInput value={r.amount} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))} />
                  </Field>
                  <Field id={`pay-m-${i}`} label={i === 0 ? 'Method' : <span className="sr-only">Method</span>} className="min-w-0 flex-1">
                    <NativeSelect value={r.method} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, method: e.target.value as PaymentMethod } : x)))}>
                      {entries(PAYMENT_METHODS).map(([k, l]) => (
                        <option key={k} value={k}>
                          {l}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                  <Button variant="ghost" size="icon" aria-label={`Remove payment ${i + 1}`} onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setRows((rs) => [...rs, { amount: remaining > 0 ? centsToRandInput(remaining) : '', method: rs.some((x) => x.method === 'cash') ? 'card' : 'cash' }])}
              >
                <Plus /> Split payment (another method)
              </Button>
              <p className="text-[13px] text-ink-muted">EFT? Only record it once you have seen the money in the bank app. A screenshot is not proof that money cleared.</p>
            </fieldset>
          ) : (
            <p className="rounded-md bg-sky-50 px-3 py-2 text-[13px] text-sky-900">Your role cannot record payments. Completing marks the visit done; the front desk records the payment.</p>
          )}

          <div className="flex items-center justify-between rounded-md bg-paper px-3 py-2 text-sm">
            <span>Still owed after these payments</span>
            <Money cents={Math.max(0, remaining)} className="font-semibold" />
          </div>

          {remaining > 0 && canDebt && (
            <div className="space-y-3 rounded-md border border-line p-3">
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox className="mt-0.5" checked={makeDebt} onChange={(e) => setMakeDebt(e.target.checked)} />
                <span>
                  Record the remaining <strong>{formatZAR(remaining)}</strong> as money the customer owes
                </span>
              </label>
              {makeDebt && (
                <>
                  <Field id="debt-due" label="Due date">
                    <Input type="date" min={todayJhb()} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                  </Field>
                  {terms && (
                    <div className="space-y-2 rounded-md bg-amber-50 p-3 text-[13px] text-amber-950">
                      <p className="font-semibold">Late-charge terms</p>
                      <p className="whitespace-pre-wrap">{terms}</p>
                      {!policy.data?.enabled && <p>The late-charge policy is switched off, so no charge will be added.</p>}
                      <label className="flex items-start gap-2.5 text-sm">
                        <Checkbox className="mt-0.5" checked={disclosed} onChange={(e) => setDisclosed(e.target.checked)} />
                        <span>Customer was shown the late-charge terms</span>
                      </label>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <Field id="complete-note" label="Note" optional>
            <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="default" loading={act.isPending} onClick={submit}>
            Complete visit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- House call: distance and estimates ----------
export function HouseCallDialog({ b, open, onOpenChange }: DialogProps) {
  const act = useBookingAction()
  const hc = b.houseCall
  const [km, setKm] = useState('')
  const [travel, setTravel] = useState('')
  const [other, setOther] = useState('')
  const [notes, setNotes] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (open && hc) {
      setKm(hc.distanceKm != null ? String(hc.distanceKm) : '')
      setTravel(centsToRandInput(hc.estimatedTravelCostCents))
      setOther(centsToRandInput(hc.estimatedOtherCostCents))
      setNotes(hc.accessNotes ?? '')
      setErrors({})
    }
  }, [open, hc])

  const submit = () => {
    const distance = km.trim() === '' ? null : Number(km.replace(',', '.'))
    if (distance !== null && (!Number.isFinite(distance) || distance < 0)) return setErrors({ distanceKm: 'Enter a distance like 6.5.' })
    const t = travel.trim() ? parseRandToCents(travel) : null
    const o = other.trim() ? parseRandToCents(other) : null
    if ((travel.trim() && t === null) || (other.trim() && o === null)) return setErrors({ estimated: 'Enter amounts like 60 or 60.50.' })
    act.mutate(
      { id: b.summary.id, m: { kind: 'house-call', input: { distanceKm: distance, estimatedTravelCostCents: t, estimatedOtherCostCents: o, accessNotes: notes.trim() || null } } },
      {
        onSuccess: () => {
          toast.success('House-call details saved')
          onOpenChange(false)
        },
        onError: (e) => {
          const fe = fieldErrors(e)
          setErrors(fe)
          if (!Object.keys(fe).length) toast.error('Could not save', { description: errorMessage(e) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Distance and cost estimates</DialogTitle>
          <DialogDescription>Distance is entered by you, not calculated. Estimates help you see whether a house call is worth it.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <Field id="hc-km" label="Distance (km)" optional error={errors.distanceKm}>
            <Input inputMode="decimal" value={km} onChange={(e) => setKm(e.target.value)} placeholder="e.g. 6.5" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="hc-travel" label="Estimated travel cost" optional error={errors.estimated}>
              <MoneyInput value={travel} onChange={(e) => setTravel(e.target.value)} />
            </Field>
            <Field id="hc-other" label="Other estimated costs" optional>
              <MoneyInput value={other} onChange={(e) => setOther(e.target.value)} />
            </Field>
          </div>
          <Field id="hc-notes" label="Access notes" optional error={errors.accessNotes}>
            <Textarea rows={2} maxLength={300} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={act.isPending} onClick={submit}>
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------- Trip expense ----------
export function TripExpenseDialog({ b, open, onOpenChange }: DialogProps) {
  const act = useBookingAction()
  const categories = useCategories()
  const expenseCats = categories.data?.expense ?? []
  const [category, setCategory] = useState('')
  const [amount, setAmount] = useState('')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(todayJhb())
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (open) {
      setCategory(expenseCats.find((c) => /transport|travel/i.test(c)) ?? expenseCats[0] ?? '')
      setAmount('')
      setDescription(`Trip for ${b.summary.reference}`)
      setDate(todayJhb())
      setMethod('cash')
      setErrors({})
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const submit = () => {
    const cents = parseRandToCents(amount)
    if (!cents || cents <= 0) return setErrors({ amountCents: 'Enter the amount spent.' })
    if (!category) return setErrors({ category: 'Choose a category.' })
    act.mutate(
      { id: b.summary.id, m: { kind: 'expense', input: { category, amountCents: cents, description: description.trim() || null, date, paymentMethod: method } } },
      {
        onSuccess: () => {
          toast.success('Trip expense recorded')
          onOpenChange(false)
        },
        onError: (e) => {
          const fe = fieldErrors(e)
          setErrors(fe)
          if (!Object.keys(fe).length) toast.error('Could not record the expense', { description: errorMessage(e) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add a trip expense</DialogTitle>
          <DialogDescription>Recorded as a business expense linked to this visit (for example taxi fare or fuel).</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="tx-amt" label="Amount" error={errors.amountCents}>
              <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field id="tx-cat" label="Category" error={errors.category}>
              <NativeSelect value={category} onChange={(e) => setCategory(e.target.value)}>
                {expenseCats.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="tx-date" label="Date" error={errors.date}>
              <Input type="date" max={todayJhb()} value={date} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <Field id="tx-method" label="Paid with" error={errors.paymentMethod}>
              <NativeSelect value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                {entries(PAYMENT_METHODS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field id="tx-desc" label="Description" optional error={errors.description}>
            <Input maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={act.isPending} onClick={submit}>
            Record expense
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
