import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { ArrowDownLeft, ArrowUpRight, Percent, Save, Store, Wallet, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { ChoiceChips } from '@/components/shared/Segmented'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { defaultPayout } from '@/lib/earnings'
import { centsToRandInput, formatDate, formatZAR, parseRandToCents } from '@/lib/format'
import { PAYMENT_METHODS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { PaymentMethod } from '@/types/api'
import type { EarningsDto, PayMode } from '@/types/pro'
import { usePayTerms, useRecordPayout, useSetPayTerms } from './api'

const MODES: { value: PayMode; label: string; body: string; icon: LucideIcon }[] = [
  { value: 'commission', label: 'Commission', body: 'A share of the services they do. Travel fees stay with the shop.', icon: Percent },
  { value: 'chair_rent', label: 'Chair rent', body: 'They pay the shop a weekly rent and keep what they take.', icon: Store },
  { value: 'wage', label: 'Weekly wage', body: 'A fixed amount per week, whatever the bookings.', icon: Wallet },
]

const METHODS = (Object.entries(PAYMENT_METHODS) as [PaymentMethod, string][]).map(([value, label]) => ({ value, label: value === 'eft' ? 'EFT' : label }))

/** Owner/manager: how a barber is paid. Statements are calculated from these terms and completed visits. */
export function PayTermsDialog({ staff, onOpenChange }: { staff: { id: string; name: string } | null; onOpenChange: (o: boolean) => void }) {
  const terms = usePayTerms(staff?.id, !!staff)
  const save = useSetPayTerms()
  const [mode, setMode] = useState<PayMode>('commission')
  const [percent, setPercent] = useState('')
  const [rent, setRent] = useState('')
  const [wage, setWage] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const t = terms.data
    if (!staff || !t) return
    setMode(t.mode ?? 'commission')
    setPercent(t.commissionPercent != null ? String(t.commissionPercent) : '')
    setRent(centsToRandInput(t.chairRentWeeklyCents))
    setWage(centsToRandInput(t.wageWeeklyCents))
    setErrors({})
  }, [staff, terms.data])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!staff) return
    const p = Number(percent.replace(',', '.'))
    const e2: Record<string, string> = {}
    if (mode === 'commission' && (!percent.trim() || !Number.isFinite(p) || p < 0 || p > 100)) e2.commissionPercent = 'Enter a percentage from 0 to 100.'
    const rentC = parseRandToCents(rent)
    const wageC = parseRandToCents(wage)
    if (mode === 'chair_rent' && rentC === null) e2.chairRentWeeklyCents = 'Enter the weekly chair rent.'
    if (mode === 'wage' && wageC === null) e2.wageWeeklyCents = 'Enter the weekly wage.'
    setErrors(e2)
    if (Object.keys(e2).length) return
    save.mutate(
      {
        staffId: staff.id,
        input: {
          mode,
          commissionPercent: mode === 'commission' ? Math.round(p * 100) / 100 : null,
          chairRentWeeklyCents: mode === 'chair_rent' ? rentC : null,
          wageWeeklyCents: mode === 'wage' ? wageC : null,
        },
      },
      {
        onSuccess: (t) => {
          toast.success(`Pay terms saved for ${staff.name}`, { description: t.modeLabel ?? undefined })
          onOpenChange(false)
        },
        onError: (err) => {
          if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])))
          else setErrors({ form: errorMessage(err) })
        },
      },
    )
  }

  return (
    <Dialog open={!!staff} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>Pay terms · {staff?.name}</DialogTitle>
          <DialogDescription>Agree these with the barber first. KasiFlow calculates a statement from them — it is not a contract or a payslip.</DialogDescription>
        </DialogHeader>
        <form id="pay-terms" onSubmit={submit} className="contents">
          <DialogBody className="space-y-5">
            {terms.isLoading ? (
              <Skeleton className="h-48" />
            ) : (
              <>
                <div role="radiogroup" aria-label="How they are paid" className="grid gap-2">
                  {MODES.map((m) => {
                    const on = mode === m.value
                    return (
                      <button
                        key={m.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => setMode(m.value)}
                        className={cn(
                          'flex min-h-16 cursor-pointer items-start gap-3 rounded-xl border p-3 text-left transition-colors',
                          on ? 'border-forest-800 bg-tint ring-1 ring-forest-800' : 'border-line-strong bg-surface hover:bg-tint',
                        )}
                      >
                        <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', on ? 'bg-emerald-brand text-forest-950' : 'bg-tint-strong text-heading')} aria-hidden>
                          <m.icon className="size-4" />
                        </span>
                        <span>
                          <span className="block font-semibold">{m.label}</span>
                          <span className="block text-[13px] text-ink-soft">{m.body}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
                {mode === 'commission' && (
                  <Field id="pt-pct" label="Barber’s share of services" hint="For example 40 means the barber earns 40% and the shop keeps 60%." error={errors.commissionPercent}>
                    <div className="relative max-w-40">
                      <Input inputMode="decimal" className="pr-9" value={percent} onChange={(e) => setPercent(e.target.value)} />
                      <span className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 font-semibold text-ink-muted" aria-hidden>
                        %
                      </span>
                    </div>
                  </Field>
                )}
                {mode === 'chair_rent' && (
                  <Field id="pt-rent" label="Chair rent per week" hint="Worked out per day for shorter periods." error={errors.chairRentWeeklyCents}>
                    <MoneyInput className="max-w-48" value={rent} onChange={(e) => setRent(e.target.value)} />
                  </Field>
                )}
                {mode === 'wage' && (
                  <Field id="pt-wage" label="Wage per week" hint="Worked out per day for shorter periods." error={errors.wageWeeklyCents}>
                    <MoneyInput className="max-w-48" value={wage} onChange={(e) => setWage(e.target.value)} />
                  </Field>
                )}
                {errors.form && (
                  <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                    {errors.form}
                  </p>
                )}
              </>
            )}
          </DialogBody>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="pay-terms" loading={save.isPending} disabled={terms.isLoading}>
            <Save /> Save terms
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Owner: record a payout already made to a barber (a Wages expense) or chair rent received from one (income).
 * Nothing is paid from here — it is a record of money that moved outside KasiFlow.
 */
export function PayoutDialog({ e, onOpenChange }: { e: EarningsDto | null; onOpenChange: (o: boolean) => void }) {
  const record = useRecordPayout()
  const [direction, setDirection] = useState<'to_barber' | 'from_barber'>('to_barber')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState<PaymentMethod>('cash')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  const name = e?.displayName.replace(/\s*\(.*?\)\s*/g, ' ').trim() ?? ''

  useEffect(() => {
    if (!e) return
    const d = defaultPayout(e.balanceCents)
    setDirection(d.direction)
    setAmount(d.amountCents > 0 ? centsToRandInput(d.amountCents) : '')
    setMethod('cash')
    setNote('')
    setError(undefined)
  }, [e])

  const cents = parseRandToCents(amount)
  const submit = (ev: React.FormEvent) => {
    ev.preventDefault()
    if (!e) return
    if (cents === null || cents <= 0) return setError('Enter the amount.')
    setError(undefined)
    record.mutate(
      { staffId: e.staffId, amountCents: direction === 'to_barber' ? cents : -cents, from: e.from, to: e.to, paymentMethod: method, note: note.trim() || null },
      {
        onSuccess: (r) => {
          toast.success(direction === 'to_barber' ? `Recorded: ${formatZAR(cents)} paid to ${name}` : `Recorded: ${formatZAR(cents)} chair rent from ${name}`, {
            description: `${direction === 'to_barber' ? 'Saved as a Wages expense' : 'Saved as income'}. Balance now ${formatZAR(r.balanceCents)}.`,
          })
          onOpenChange(false)
        },
        onError: (err) => setError(errorMessage(err)),
      },
    )
  }

  return (
    <Dialog open={!!e} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Record a payout you made</DialogTitle>
          <DialogDescription>
            {name} · {e ? `${formatDate(e.from)} to ${formatDate(e.to)}` : ''}. KasiFlow does not move money — this records money that already changed hands.
          </DialogDescription>
        </DialogHeader>
        <form id="payout" onSubmit={submit} className="contents">
          <DialogBody className="space-y-5">
            <div role="radiogroup" aria-label="Which way" className="grid grid-cols-2 gap-2">
              {(
                [
                  ['to_barber', 'Paid to barber', ArrowUpRight, 'Wages expense'],
                  ['from_barber', 'Chair rent received', ArrowDownLeft, 'Income'],
                ] as const
              ).map(([k, label, Icon, sub]) => (
                <button
                  key={k}
                  type="button"
                  role="radio"
                  aria-checked={direction === k}
                  onClick={() => setDirection(k)}
                  className={cn(
                    'flex min-h-16 cursor-pointer flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition-colors',
                    direction === k ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong bg-surface hover:bg-tint',
                  )}
                >
                  <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold">
                    <Icon className="size-4" aria-hidden /> {label}
                  </span>
                  <span className={cn('text-[12px]', direction === k ? 'opacity-80' : 'text-ink-muted')}>{sub}</span>
                </button>
              ))}
            </div>
            <Field id="po-amt" label="Amount" hint={e ? `The statement balance is ${formatZAR(e.balanceCents)} (${e.balanceCents >= 0 ? 'shop owes' : 'barber owes'}).` : undefined}>
              <MoneyInput className="h-13 text-lg font-semibold" value={amount} onChange={(x) => setAmount(x.target.value)} />
            </Field>
            <div className="space-y-2">
              <p className="text-sm font-semibold">How it was paid</p>
              <ChoiceChips label="How it was paid" options={METHODS} selected={[method]} onToggle={(m) => setMethod(m)} />
            </div>
            <Field id="po-note" label="Note" optional>
              <Textarea rows={2} maxLength={300} value={note} onChange={(x) => setNote(x.target.value)} placeholder="e.g. Paid Friday after cash-up" />
            </Field>
            {error && (
              <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                {error}
              </p>
            )}
          </DialogBody>
        </form>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form="payout" loading={record.isPending}>
            Record {cents ? formatZAR(cents) : 'payout'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
