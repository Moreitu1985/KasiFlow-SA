import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Lock, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { Callout } from '@/components/shared/Callout'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { ErrorState } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { centsToRandInput, formatZAR, parseRandToCents } from '@/lib/format'
import { useAccess } from '@/features/access/useAccess'
import { useBookingPolicy, useUpdateBookingPolicy } from '@/features/bookings/api'
import { useDebtPolicy, useUpdateDebtPolicy } from '@/features/debts/api'
import type { BookingPolicyDto, TravelFeeMode } from '@/types/barbershop'

function apiErrors(err: unknown): Record<string, string> {
  return err instanceof ApiError ? Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])) : {}
}

function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (c: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <Label htmlFor={id}>{label}</Label>
        {hint && <p className="text-[13px] text-ink-muted">{hint}</p>}
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  )
}

export function BookingPolicyCard() {
  const { can } = useAccess()
  const canEdit = can('manageSettings')
  const q = useBookingPolicy()
  const save = useUpdateBookingPolicy()
  const [v, setV] = useState<BookingPolicyDto | null>(null)
  const [money, setMoney] = useState({ flat: '', perKm: '', min: '', maxKm: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!q.data) return
    setV(q.data)
    setMoney({
      flat: centsToRandInput(q.data.travelFeeFlatCents),
      perKm: centsToRandInput(q.data.travelFeePerKmCents),
      min: centsToRandInput(q.data.minTravelFeeCents),
      maxKm: q.data.maxTravelKm == null ? '' : String(q.data.maxTravelKm),
    })
  }, [q.data])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!v) return
    const flat = parseRandToCents(money.flat || '0')
    const perKm = parseRandToCents(money.perKm || '0')
    const min = parseRandToCents(money.min || '0')
    const maxKm = money.maxKm.trim() ? Number(money.maxKm.replace(',', '.')) : null
    if (flat === null || perKm === null || min === null) return setErrors({ travelFee: 'Enter amounts like 100 or 7.50.' })
    if (maxKm !== null && !(maxKm > 0)) return setErrors({ maxTravelKm: 'Enter a positive distance or leave it empty.' })
    setErrors({})
    save.mutate(
      { ...v, travelFeeFlatCents: flat, travelFeePerKmCents: perKm, minTravelFeeCents: min, maxTravelKm: maxKm },
      {
        onSuccess: () => toast.success('Booking policy saved'),
        onError: (err) => {
          const fe = apiErrors(err)
          setErrors(fe)
          if (!Object.keys(fe).length) toast.error('Could not save', { description: errorMessage(err) })
        },
      },
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Booking policy</CardTitle>
        <CardDescription>How customers book, how far ahead, and how house-call travel is charged.</CardDescription>
      </CardHeader>
      <CardContent>
        {q.isLoading || !v ? (
          q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <Skeleton className="h-64" />
        ) : (
          <form onSubmit={submit} noValidate className="space-y-5">
            <fieldset disabled={!canEdit} className="space-y-5">
              <Toggle id="bp-auto" label="Confirm online bookings automatically" hint="Off: every online booking is a request until someone confirms it." checked={v.bookingAutoConfirm} onChange={(c) => setV({ ...v, bookingAutoConfirm: c })} />
              <Toggle
                id="bp-override"
                label="Allow approved exceptions"
                hint="The owner or an administrator may confirm a booking outside a barber’s hours or during time off, with a reason."
                checked={v.allowOffDutyOverride}
                onChange={(c) => setV({ ...v, allowOffDutyOverride: c })}
              />
              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="bp-slot" label="Time slots every" error={errors.slotIntervalMinutes}>
                  <NativeSelect value={v.slotIntervalMinutes} onChange={(e) => setV({ ...v, slotIntervalMinutes: Number(e.target.value) })}>
                    {[5, 10, 15, 20, 30, 60].map((m) => (
                      <option key={m} value={m}>
                        {m} minutes
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <Field id="bp-lead" label="Minimum notice (minutes)" error={errors.bookingLeadMinutes}>
                  <Input inputMode="numeric" value={v.bookingLeadMinutes} onChange={(e) => setV({ ...v, bookingLeadMinutes: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                </Field>
                <Field id="bp-horizon" label="Book up to (days ahead)" error={errors.bookingHorizonDays}>
                  <Input inputMode="numeric" value={v.bookingHorizonDays} onChange={(e) => setV({ ...v, bookingHorizonDays: Number(e.target.value.replace(/\D/g, '')) || 0 })} />
                </Field>
              </div>
              <div className="space-y-4 rounded-md border border-line p-4">
                <Toggle id="bp-house" label="Take house calls" checked={v.houseCallsEnabled} onChange={(c) => setV({ ...v, houseCallsEnabled: c })} />
                {v.houseCallsEnabled && (
                  <>
                    <Field id="bp-mode" label="Travel fee" error={errors.travelFeeMode}>
                      <NativeSelect value={v.travelFeeMode} onChange={(e) => setV({ ...v, travelFeeMode: e.target.value as TravelFeeMode })}>
                        <option value="flat">Flat fee per visit</option>
                        <option value="per_km">Per kilometre</option>
                        <option value="none">No travel fee</option>
                      </NativeSelect>
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-3">
                      {v.travelFeeMode === 'flat' && (
                        <Field id="bp-flat" label="Flat fee" error={errors.travelFee}>
                          <MoneyInput value={money.flat} onChange={(e) => setMoney({ ...money, flat: e.target.value })} />
                        </Field>
                      )}
                      {v.travelFeeMode === 'per_km' && (
                        <Field id="bp-perkm" label="Fee per km" error={errors.travelFee}>
                          <MoneyInput value={money.perKm} onChange={(e) => setMoney({ ...money, perKm: e.target.value })} />
                        </Field>
                      )}
                      {v.travelFeeMode !== 'none' && (
                        <Field id="bp-min" label="Minimum fee">
                          <MoneyInput value={money.min} onChange={(e) => setMoney({ ...money, min: e.target.value })} />
                        </Field>
                      )}
                      <Field id="bp-max" label="Maximum distance (km)" optional error={errors.maxTravelKm}>
                        <Input inputMode="decimal" value={money.maxKm} onChange={(e) => setMoney({ ...money, maxKm: e.target.value })} />
                      </Field>
                    </div>
                    <p className="rounded-md bg-paper px-3 py-2 text-[13px] text-ink-soft">
                      Customers currently see: “{q.data?.travelFeeDescription}”
                      {!q.data?.distanceProviderConfigured && ' Distances are entered by your team; KasiFlow does not calculate them.'}
                    </p>
                  </>
                )}
              </div>
            </fieldset>
            {canEdit ? (
              <Button type="submit" loading={save.isPending}>
                Save booking policy
              </Button>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
                <Lock className="size-3.5" aria-hidden /> Only people who manage settings can change this.
              </p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  )
}

export function DebtPolicyCard() {
  const { can } = useAccess()
  const canEdit = can('configureDebtPolicy')
  const q = useDebtPolicy()
  const save = useUpdateDebtPolicy()
  const [v, setV] = useState({ enabled: false, amount: '', overdueDays: '7', legallyReviewed: false, reviewedNote: '', terms: '' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!q.data) return
    setV({
      enabled: q.data.enabled,
      amount: centsToRandInput(q.data.amountCents),
      overdueDays: String(q.data.overdueDays),
      legallyReviewed: q.data.legallyReviewed,
      reviewedNote: q.data.reviewedNote ?? '',
      terms: q.data.terms ?? '',
    })
  }, [q.data])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const amount = parseRandToCents(v.amount)
    if (!amount) return setErrors({ amountCents: 'Enter the charge amount.' })
    setErrors({})
    save.mutate(
      {
        enabled: v.enabled,
        amountCents: amount,
        overdueDays: Number.parseInt(v.overdueDays, 10) || 0,
        legallyReviewed: v.legallyReviewed,
        reviewedNote: v.reviewedNote.trim() || null,
        terms: v.terms.trim() || null,
      },
      {
        onSuccess: () => toast.success('Debt-charge policy saved', { description: 'Existing debts keep the terms that were shown when they were created.' }),
        onError: (err) => {
          const fe = apiErrors(err)
          setErrors(fe)
          if (!Object.keys(fe).length) toast.error('Could not save', { description: errorMessage(err) })
        },
      },
    )
  }

  const d = q.data
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle>Late charge on overdue debts</CardTitle>
          {d && (d.appliesToRealDebts ? <Badge variant="warning">Active</Badge> : <Badge variant="neutral">Not applied — proposals only</Badge>)}
        </div>
        <CardDescription>An optional, once-off charge when a customer debt becomes overdue. Only the owner can change it.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <Callout tone="critical" title="A flat fee is not lawful for every debt">
          Charging customers extra on debt is regulated. Depending on the agreement and the customer, a flat late fee may not be allowed at all. Get advice
          (for example from an attorney) before you switch this on. KasiFlow does not give legal advice.
        </Callout>
        {d && (
          <div className="rounded-md border border-forest-800/20 bg-forest-50 p-4">
            <p className="flex items-center gap-2 text-sm font-semibold text-forest-950">
              <ShieldAlert className="size-4" aria-hidden /> Safeguards KasiFlow always applies
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-[13px] leading-relaxed text-forest-950">
              {d.safeguards.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        )}
        {q.isLoading ? (
          <Skeleton className="h-48" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : (
          <form onSubmit={submit} noValidate className="space-y-4">
            <fieldset disabled={!canEdit} className="space-y-4">
              <Toggle id="dp-enabled" label="Policy enabled" checked={v.enabled} onChange={(c) => setV({ ...v, enabled: c })} disabled={!canEdit} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="dp-amount" label="Charge amount (once per debt)" error={errors.amountCents}>
                  <MoneyInput value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value })} />
                </Field>
                <Field id="dp-days" label="Days overdue before it applies" error={errors.overdueDays}>
                  <Input inputMode="numeric" value={v.overdueDays} onChange={(e) => setV({ ...v, overdueDays: e.target.value.replace(/\D/g, '') })} />
                </Field>
              </div>
              <Field id="dp-terms" label="Terms customers are shown" hint="Shown to the customer before they agree to owe money. Keep it plain and specific." error={errors.terms}>
                <Textarea rows={3} maxLength={1000} value={v.terms} onChange={(e) => setV({ ...v, terms: e.target.value })} />
              </Field>
              <label className="flex items-start gap-2.5 text-sm">
                <Checkbox className="mt-0.5" checked={v.legallyReviewed} onChange={(e) => setV({ ...v, legallyReviewed: e.target.checked })} />
                <span>
                  <strong>These terms were legally reviewed.</strong> Charges are only added to what customers owe when this is ticked, the policy is enabled
                  and the customer was shown the terms.
                </span>
              </label>
              {v.legallyReviewed && (
                <Field id="dp-note" label="Who reviewed it, and when" error={errors.reviewedNote}>
                  <Input maxLength={500} value={v.reviewedNote} onChange={(e) => setV({ ...v, reviewedNote: e.target.value })} placeholder="e.g. Attorney N. Dlamini, 10 Oct 2026" />
                </Field>
              )}
            </fieldset>
            {d && (
              <p className="text-[13px] text-ink-muted">
                Policy version {d.version}. Current charge: {formatZAR(d.amountCents)} after {d.overdueDays} days overdue.
              </p>
            )}
            {canEdit ? (
              <Button type="submit" loading={save.isPending}>
                Save debt-charge policy
              </Button>
            ) : (
              <p className="inline-flex items-center gap-1.5 text-[13px] text-ink-muted">
                <Lock className="size-3.5" aria-hidden /> Read-only: only the owner can change this policy.
              </p>
            )}
          </form>
        )}
      </CardContent>
    </Card>
  )
}
