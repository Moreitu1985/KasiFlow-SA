import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Armchair, Banknote, Megaphone, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, NativeSelect } from '@/components/ui/input'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { ChoiceChips } from '@/components/shared/Segmented'
import { StaffStatusBadge } from '@/components/shared/StatusBadges'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { centsToRandInput, formatRandShort, formatZAR, parseRandToCents } from '@/lib/format'
import { PAYMENT_METHODS } from '@/lib/labels'
import { displayName, priceFromSummary } from '@/lib/queue'
import { cn } from '@/lib/utils'
import type { PaymentMethod } from '@/types/api'
import type { ServiceDto, StaffProfileDto } from '@/types/barbershop'
import type { QueueTicketDto } from '@/types/pro'
import { useAddWalkIn, useQueueAction } from './api'

const METHODS = (Object.entries(PAYMENT_METHODS) as [PaymentMethod, string][]).map(([value, label]) => ({ value, label: value === 'eft' ? 'EFT' : label }))

/** Front desk: add a walk-in. A name is enough; services and a preferred barber make the wait estimate better. */
export function AddWalkInDialog({ open, onOpenChange, services, team }: { open: boolean; onOpenChange: (o: boolean) => void; services: ServiceDto[]; team: StaffProfileDto[] }) {
  const add = useAddWalkIn()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [pref, setPref] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setName('')
    setPhone('')
    setPicked([])
    setPref('')
    setErrors({})
  }, [open])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (name.trim().length < 1) return setErrors({ customerName: 'Enter a name (a first name is fine).' })
    add.mutate(
      { customerName: name.trim(), customerPhone: phone.trim() || null, serviceIds: picked, preferredStaffId: pref || null },
      {
        onSuccess: (board) => {
          const n = Math.max(0, ...board.open.map((t) => t.number))
          toast.success(`Walk-in #${n} added`, { description: board.nextWaitLabel ? `Next wait: ${board.nextWaitLabel.toLowerCase()} (an estimate)` : undefined })
          onOpenChange(false)
        },
        onError: (err) => {
          if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])))
          else setErrors({ form: errorMessage(err) })
        },
      },
    )
  }

  const barbers = team.filter((t) => t.isActive && t.isBookable)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>Add a walk-in</DialogTitle>
          <DialogDescription>They get the next number. Services help the wait estimate; leave them empty if they are not sure yet.</DialogDescription>
        </DialogHeader>
        <form id="add-walkin" onSubmit={submit} className="contents">
          <DialogBody className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="wi-name" label="Name" error={errors.customerName}>
                <Input autoFocus autoComplete="off" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sipho M." />
              </Field>
              <Field id="wi-phone" label="Phone" optional hint="Only if they want to step out and be called back." error={errors.customerPhone}>
                <Input type="tel" inputMode="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Field>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-semibold">
                Services <span className="font-normal text-ink-muted">(optional)</span>
              </legend>
              {services.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No services listed yet.</p>
              ) : (
                <ChoiceChips
                  label="Services"
                  options={services.map((s) => ({ value: s.id, label: s.name, hint: formatRandShort(s.priceCents) }))}
                  selected={picked}
                  onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id].slice(0, 6)))}
                />
              )}
              {errors.serviceIds && <p className="text-[13px] font-medium text-red-700">{errors.serviceIds}</p>}
            </fieldset>
            <Field id="wi-pref" label="Preferred barber" optional error={errors.preferredStaffId}>
              <NativeSelect value={pref} onChange={(e) => setPref(e.target.value)}>
                <option value="">Any barber (first one free)</option>
                {barbers.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.displayName} · {b.status.label}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            {errors.form && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                {errors.form}
              </p>
            )}
          </DialogBody>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="add-walkin" loading={add.isPending}>
            <UserPlus /> Add to the queue
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Front desk: send a waiting customer to a barber — call them up, or straight into the chair. */
export function SendToBarberDialog({ ticket, onOpenChange, team }: { ticket: QueueTicketDto | null; onOpenChange: (o: boolean) => void; team: StaffProfileDto[] }) {
  const act = useQueueAction()
  const [staffId, setStaffId] = useState('')
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (!ticket) return
    setStaffId(ticket.preferredStaffId ?? ticket.staffId ?? '')
    setError(undefined)
  }, [ticket])
  const barbers = team.filter((t) => t.isActive && t.isBookable)
  const go = (action: 'call' | 'start') => {
    if (!ticket) return
    if (!staffId) return setError('Choose the barber who takes this customer.')
    act.mutate(
      { id: ticket.id, action, input: { staffId } },
      {
        onSuccess: () => {
          const who = barbers.find((b) => b.id === staffId)?.displayName ?? 'the barber'
          toast.success(action === 'call' ? `#${ticket.number} called up for ${who}` : `#${ticket.number} is in ${who}’s chair`)
          onOpenChange(false)
        },
        onError: (e) => setError(errorMessage(e)),
      },
    )
  }
  return (
    <Dialog open={!!ticket} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send #{ticket?.number} to a barber</DialogTitle>
          <DialogDescription>
            {displayName(ticket?.customerName ?? '')} · {ticket?.servicesSummary}
            {ticket?.preferredStaffName ? ` · asked for ${ticket.preferredStaffName}` : ''}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div role="radiogroup" aria-label="Barber" className="grid gap-2">
            {barbers.map((b) => {
              const on = staffId === b.id
              return (
                <button
                  key={b.id}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setStaffId(b.id)}
                  className={cn(
                    'flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left transition-colors',
                    on ? 'border-forest-800 bg-tint ring-1 ring-forest-800' : 'border-line-strong bg-surface hover:bg-tint',
                  )}
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{b.displayName}</span>
                    <span className="block text-[12px] text-ink-muted">{ticket?.preferredStaffId === b.id ? 'Asked for by the customer' : b.roleTitle}</span>
                  </span>
                  <StaffStatusBadge status={b.status.status} label={b.status.label} stale={b.status.stale} />
                </button>
              )
            })}
          </div>
          {error && (
            <p role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" loading={act.isPending && act.variables?.action === 'call'} disabled={act.isPending} onClick={() => go('call')}>
            <Megaphone /> Call them up
          </Button>
          <Button type="button" loading={act.isPending && act.variables?.action === 'start'} disabled={act.isPending} onClick={() => go('start')}>
            <Armchair /> Straight into the chair
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Finish a walk-in: it becomes a completed booking priced at the barber's prices. The amount is prefilled from those
 * prices when every service is known; "No payment taken" finishes it without recording money.
 */
export function FinishDialog({
  ticket,
  onOpenChange,
  prices,
  canPay,
}: {
  ticket: QueueTicketDto | null
  onOpenChange: (o: boolean) => void
  /** The finishing barber's own prices (from their profile). */
  prices: { serviceName: string; priceCents: number }[]
  canPay: boolean
}) {
  const act = useQueueAction()
  const suggested = useMemo(() => (ticket ? priceFromSummary(ticket.servicesSummary, prices) : null), [ticket, prices])
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [noPayment, setNoPayment] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!ticket) return
    setAmount(suggested != null ? centsToRandInput(suggested) : '')
    setMethod('cash')
    setNoPayment(!canPay)
    setError(undefined)
  }, [ticket, suggested, canPay])

  const cents = parseRandToCents(amount)
  const submit = () => {
    if (!ticket) return
    if (!noPayment && (cents === null || cents <= 0)) return setError('Enter what the customer paid, or tick “No payment taken”.')
    setError(undefined)
    const payments = noPayment || cents === null ? [] : [{ amountCents: cents, paymentMethod: method }]
    act.mutate(
      { id: ticket.id, action: 'done', input: { payments } },
      {
        onSuccess: () => {
          toast.success(`Walk-in #${ticket.number} done`, {
            description: payments.length ? `${formatZAR(payments[0].amountCents)} ${PAYMENT_METHODS[method].toLowerCase()} recorded with the visit.` : 'Finished without a payment record.',
          })
          onOpenChange(false)
        },
        onError: (e) => setError(errorMessage(e)),
      },
    )
  }

  return (
    <Dialog open={!!ticket} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>
            Done: #{ticket?.number} {displayName(ticket?.customerName ?? '')}
          </DialogTitle>
          <DialogDescription>
            {ticket?.servicesSummary}
            {ticket?.staffName ? ` · ${ticket.staffName}` : ''}. It is saved as a completed visit at the barber’s prices.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-5">
          {canPay ? (
            <>
              <fieldset disabled={noPayment} className={cn('space-y-4 transition-opacity', noPayment && 'opacity-50')}>
                <Field
                  id="fin-amount"
                  label="Amount paid"
                  hint={
                    suggested != null
                      ? `Prefilled from ${ticket?.staffName?.split(' ')[0] ?? 'the barber'}’s prices: ${formatZAR(suggested)}. Record tips separately.`
                      : 'The price is not known for every service here — enter what the customer paid.'
                  }
                >
                  <MoneyInput className="h-13 text-lg font-semibold" value={amount} onChange={(e) => setAmount(e.target.value)} />
                </Field>
                <div className="space-y-2">
                  <p className="text-sm font-semibold">How they paid</p>
                  <ChoiceChips label="How they paid" options={METHODS} selected={[method]} onToggle={(m) => setMethod(m)} />
                </div>
              </fieldset>
              <label htmlFor="fin-none" className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line p-3 text-sm">
                <Checkbox id="fin-none" className="mt-0.5" checked={noPayment} onChange={(e) => setNoPayment(e.target.checked)} />
                <span>
                  <span className="font-medium">No payment taken now</span>
                  <span className="block text-[12px] text-ink-muted">For example, they pay at the front desk, or it was a free touch-up.</span>
                </span>
              </label>
            </>
          ) : (
            <p className="rounded-md bg-tint px-3 py-2.5 text-sm">The front desk records the payment. Tap Done when the cut is finished so the next customer can be called.</p>
          )}
          {error && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Not yet
          </Button>
          <Button type="button" variant="accent" loading={act.isPending} onClick={submit}>
            <Banknote /> {noPayment ? 'Mark done' : `Done · ${cents ? formatZAR(cents) : 'R0.00'}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
