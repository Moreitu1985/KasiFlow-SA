import { useState } from 'react'
import { toast } from 'sonner'
import { CircleCheck, CircleDashed } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Checkbox, Input } from '@/components/ui/input'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { accountForm, accountInput, type AccountForm } from '@/lib/customer'
import type { CustomerAccountDto } from '@/types/customer'
import { useUpdateCustomerAccount } from './api'

/** House-call readiness as a checklist: a tick or an open circle plus text, so colour is never the only signal. */
export function HouseCallReadiness({ account, className }: { account: CustomerAccountDto; className?: string }) {
  if (account.houseCallReady)
    return (
      <p className={`flex items-center gap-2 rounded-md bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 ${className ?? ''}`}>
        <CircleCheck className="size-5 shrink-0" aria-hidden /> Ready for house calls
      </p>
    )
  return (
    <div className={className}>
      <p className="text-sm font-semibold">Still needed for house calls</p>
      <ul className="mt-1.5 space-y-1.5">
        {account.missingForHouseCall.map((m) => (
          <li key={m} className="flex items-start gap-2 text-sm text-ink-soft">
            <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-700" aria-hidden />
            <span>
              <span className="sr-only">Missing: </span>
              {m}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The customer's saved details. Everything is optional for bookings at the shop; house calls need a name, a phone
 * number, an address and agreeing to the safety terms (the API decides and returns what is still missing).
 */
export function AccountDetailsForm({
  account,
  onSaved,
  submitLabel = 'Save my details',
  idPrefix = 'acc',
}: {
  account: CustomerAccountDto
  onSaved?: (a: CustomerAccountDto) => void
  submitLabel?: string
  idPrefix?: string
}) {
  const save = useUpdateCustomerAccount()
  const [v, setV] = useState<AccountForm>(() => accountForm(account))
  const [terms, setTerms] = useState(account.houseCallTermsAccepted)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const set = (k: keyof AccountForm) => (e: React.ChangeEvent<HTMLInputElement>) => setV((x) => ({ ...x, [k]: e.target.value }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setErrors({})
    save.mutate(
      { ...accountInput(v), acceptHouseCallTerms: terms === account.houseCallTermsAccepted ? null : terms },
      {
        onSuccess: (a) => {
          toast.success('Your details are saved')
          setTerms(a.houseCallTermsAccepted)
          onSaved?.(a)
        },
        onError: (err) => {
          if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, x]) => [k, x[0]])))
          else toast.error('Could not save your details', { description: errorMessage(err) })
        },
      },
    )
  }

  const id = (k: string) => `${idPrefix}-${k}`
  return (
    <form onSubmit={submit} noValidate className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id={id('name')} label="Full name" error={errors.fullName}>
          <Input autoComplete="name" maxLength={120} value={v.fullName} onChange={set('fullName')} />
        </Field>
        <Field id={id('phone')} label="Contact phone" hint="The barber calls this number on the day." error={errors.contactPhone}>
          <Input type="tel" autoComplete="tel" maxLength={30} value={v.contactPhone} onChange={set('contactPhone')} />
        </Field>
      </div>
      <Field id={id('addr')} label="Street address" hint="Only for house calls. Shared with the shop you book with." error={errors.addressLine}>
        <Input autoComplete="street-address" maxLength={200} value={v.addressLine} onChange={set('addressLine')} />
      </Field>
      <div className="grid grid-cols-1 gap-4 min-[420px]:grid-cols-2">
        <Field id={id('suburb')} label="Suburb / section" optional error={errors.suburb}>
          <Input maxLength={80} autoComplete="address-level3" value={v.suburb} onChange={set('suburb')} />
        </Field>
        <Field id={id('town')} label="Town" optional error={errors.town}>
          <Input maxLength={80} autoComplete="address-level2" value={v.town} onChange={set('town')} />
        </Field>
      </div>
      <Field id={id('access')} label="How to find you" optional hint="Gate colour, landmark, which house in the yard…" error={errors.accessNotes}>
        <Input maxLength={300} value={v.accessNotes} onChange={set('accessNotes')} />
      </Field>
      <div className="space-y-2 rounded-md border border-line bg-paper/70 p-3">
        <p className="text-sm font-semibold">House-call safety terms</p>
        <p className="text-[13px] leading-relaxed text-ink-soft">{account.houseCallTerms}</p>
        <label htmlFor={id('terms')} className="flex cursor-pointer items-start gap-2.5 text-sm font-medium">
          <Checkbox id={id('terms')} className="mt-0.5" checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>I agree to these terms for house calls</span>
        </label>
        {errors.acceptHouseCallTerms && (
          <p role="alert" className="text-[13px] font-medium text-red-700">
            {errors.acceptHouseCallTerms}
          </p>
        )}
      </div>
      <Button type="submit" size="lg" className="w-full sm:w-auto" loading={save.isPending}>
        {submitLabel}
      </Button>
    </form>
  )
}
