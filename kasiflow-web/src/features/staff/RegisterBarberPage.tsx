import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, ArrowRight, Car, CheckCircle2, Lock, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { Money } from '@/components/shared/Money'
import { RoleHeader } from '@/features/access/RoleHeader'
import { ErrorState, ListSkeleton } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { parseRandToCents } from '@/lib/format'
import { durationLabel, validateHours, WEEKDAY_NAMES } from '@/lib/barbershop'
import { defaultBarberHours, isEmail } from '@/lib/customer'
import { cn } from '@/lib/utils'
import { useBranches } from '@/features/branches/api'
import { useRegisterBarber, useServices } from '@/features/team/api'
import type { WorkingHoursDto } from '@/types/barbershop'
import type { RegisterBarberResultDto } from '@/types/customer'
import { InviteLinkResult } from './InviteLinkResult'

const STEPS = ['Details', 'Services', 'Hours', 'Login'] as const
const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0]

interface Details {
  displayName: string
  roleTitle: string
  branchId: string
  bio: string
  specialties: string
  contactPhone: string
  emergencyContactName: string
  emergencyContactPhone: string
}

type DayRow = { on: boolean; start: string; end: string }

function initialDays(): Record<number, DayRow> {
  const out: Record<number, DayRow> = {}
  const def = defaultBarberHours()
  for (const d of DAY_ORDER) {
    const h = def.find((x) => x.weekday === d)
    out[d] = h ? { on: true, start: h.start, end: h.end } : { on: false, start: '08:00', end: '18:00' }
  }
  return out
}

function Done({ result, email, onAnother }: { result: RegisterBarberResultDto; email: string; onAnother: () => void }) {
  const p = result.profile
  const heading = useRef<HTMLHeadingElement>(null)
  useEffect(() => heading.current?.focus(), [])
  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <CheckCircle2 className="size-10 text-emerald-600" aria-hidden />
        <div>
          <h2 ref={heading} tabIndex={-1} className="text-2xl font-bold outline-none">
            {p.displayName} is registered
          </h2>
          <p className="mt-1 text-[15px] text-ink-soft">
            {p.services.length} {p.services.length === 1 ? 'service' : 'services'} · {p.hours.length} working {p.hours.length === 1 ? 'block' : 'blocks'} a week
            {p.acceptsHouseCalls ? ' · does house calls' : ''}. Customers can book {p.displayName.split(' ')[0]} now.
          </p>
        </div>
        {result.invitePath ? (
          <InviteLinkResult name={p.displayName} email={p.pendingLogin?.email ?? email} invitePath={result.invitePath} inviteMessage={result.inviteMessage} expiresAt={p.pendingLogin?.expiresAt} />
        ) : (
          <p className="rounded-md bg-paper px-3 py-2 text-sm text-ink-soft">{result.inviteMessage ?? 'No login yet. You can send a login link later from Team profiles.'}</p>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button onClick={onAnother}>
            <UserPlus /> Register another barber
          </Button>
          <Button asChild variant="outline">
            <Link to="/staff?tab=profiles">Back to team profiles</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

/** /team/register — owner-side "Register a barber": details, services and prices, weekly hours, house calls and a login link. */
export function RegisterBarberPage() {
  const services = useServices(false)
  const branches = useBranches()
  const register = useRegisterBarber()
  const [step, setStep] = useState(0)
  const [d, setD] = useState<Details>({ displayName: '', roleTitle: 'Barber', branchId: '', bio: '', specialties: '', contactPhone: '', emergencyContactName: '', emergencyContactPhone: '' })
  const [picked, setPicked] = useState<Record<string, { on: boolean; price: string }>>({})
  const [days, setDays] = useState(initialDays)
  const [houseCalls, setHouseCalls] = useState(false)
  const [giveLogin, setGiveLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [result, setResult] = useState<RegisterBarberResultDto | null>(null)
  const top = useRef<HTMLHeadingElement>(null)

  const list = useMemo(() => (services.data ?? []).filter((s) => s.isActive), [services.data])
  // Every active service is ticked by default; owners untick what this barber does not do.
  const isOn = (id: string) => picked[id]?.on ?? true
  const activeBranches = (branches.data ?? []).filter((b) => b.isActive)

  const hours: WorkingHoursDto[] = DAY_ORDER.filter((x) => days[x].on).map((x) => ({ weekday: x, start: days[x].start, end: days[x].end }))

  const setField = (k: keyof Details) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setD((x) => ({ ...x, [k]: e.target.value }))

  const validate = (s: number): Record<string, string> => {
    const e: Record<string, string> = {}
    if (s === 0 && d.displayName.trim().length < 2) e.displayName = 'Enter the name customers will see.'
    if (s === 1) {
      for (const sv of list) {
        const p = picked[sv.id]
        if (isOn(sv.id) && p?.price.trim() && parseRandToCents(p.price) === null) e[`price-${sv.id}`] = 'Enter a price like 120 or 120.00, or leave it empty.'
      }
    }
    if (s === 2) {
      const problem = validateHours(hours)
      if (problem) e.hours = problem
    }
    if (s === 3 && giveLogin && !isEmail(email)) e.loginEmail = 'Enter the email address the barber will sign in with.'
    return e
  }

  const go = (to: number) => {
    if (to > step) {
      const e = validate(step)
      setErrors(e)
      if (Object.keys(e).length) return
    }
    setErrors({})
    setStep(to)
    top.current?.focus()
  }

  const submit = () => {
    for (let s = 0; s < STEPS.length; s++) {
      const e = validate(s)
      if (Object.keys(e).length) {
        setErrors(e)
        setStep(s)
        return
      }
    }
    register.mutate(
      {
        displayName: d.displayName.trim(),
        roleTitle: d.roleTitle.trim() || null,
        branchId: d.branchId || null,
        acceptsHouseCalls: houseCalls,
        bio: d.bio.trim() || null,
        specialties: d.specialties.trim() || null,
        contactPhone: d.contactPhone.trim() || null,
        emergencyContactName: d.emergencyContactName.trim() || null,
        emergencyContactPhone: d.emergencyContactPhone.trim() || null,
        services: list.filter((s) => isOn(s.id)).map((s) => ({ serviceId: s.id, priceCents: picked[s.id]?.price.trim() ? parseRandToCents(picked[s.id].price) : null })),
        hours,
        loginEmail: giveLogin ? email.trim() : null,
      },
      {
        onSuccess: (r) => {
          toast.success(`${r.profile.displayName} registered`)
          setResult(r)
        },
        onError: (err) => {
          if (err instanceof ApiError && Object.keys(err.errors).length) {
            const fe = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]]))
            setErrors(fe)
            const keys = Object.keys(fe)
            setStep(keys.some((k) => k === 'loginEmail') ? 3 : keys.some((k) => k === 'hours' || k === 'weekday') ? 2 : keys.some((k) => k === 'services') ? 1 : 0)
          } else toast.error('Could not register the barber', { description: errorMessage(err) })
        },
      },
    )
  }

  const reset = () => {
    setResult(null)
    setStep(0)
    setD({ displayName: '', roleTitle: 'Barber', branchId: '', bio: '', specialties: '', contactPhone: '', emergencyContactName: '', emergencyContactPhone: '' })
    setPicked({})
    setDays(initialDays())
    setHouseCalls(false)
    setGiveLogin(true)
    setEmail('')
    setErrors({})
  }

  return (
    <div className="max-w-3xl">
      <Link to="/staff?tab=profiles" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-forest-800 hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Team profiles
      </Link>
      <RoleHeader title="Register a barber" description="Add a barber customers can book: their details, what they do and charge, their hours, and a login for their own barber screen." />

      {result ? (
        <Done result={result} email={email} onAnother={reset} />
      ) : (
        <>
          <ol className="mb-5 grid grid-cols-4 gap-1.5" aria-label="Steps">
            {STEPS.map((label, i) => (
              <li key={label} aria-current={i === step ? 'step' : undefined}>
                <button
                  type="button"
                  onClick={() => (i < step ? go(i) : undefined)}
                  disabled={i > step}
                  className={cn(
                    'flex w-full flex-col items-center gap-1 rounded-md px-1 py-2 text-[12px] font-semibold sm:flex-row sm:justify-center sm:gap-2 sm:text-sm',
                    i === step ? 'bg-primary text-primary-fg' : i < step ? 'cursor-pointer bg-forest-50 text-heading hover:bg-forest-100' : 'bg-paper text-ink-muted',
                  )}
                >
                  <span className={cn('flex size-6 items-center justify-center rounded-full border text-[12px]', i === step ? 'border-white/40' : 'border-current/30')}>{i + 1}</span>
                  {label}
                </button>
              </li>
            ))}
          </ol>

          <Card>
            <CardContent className="space-y-5 pt-5">
              <h2 ref={top} tabIndex={-1} className="text-lg font-semibold outline-none">
                {step === 0 ? 'About the barber' : step === 1 ? 'Services and prices' : step === 2 ? 'Weekly hours' : 'House calls and login'}
              </h2>

              {step === 0 && (
                <div className="space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field id="rb-name" label="Name customers see" error={errors.displayName}>
                      <Input autoFocus maxLength={80} value={d.displayName} onChange={setField('displayName')} placeholder="e.g. Sipho M." />
                    </Field>
                    <Field id="rb-title" label="Role title" optional error={errors.roleTitle}>
                      <Input maxLength={60} value={d.roleTitle} onChange={setField('roleTitle')} placeholder="Barber, Junior barber…" />
                    </Field>
                  </div>
                  {activeBranches.length > 1 && (
                    <Field id="rb-branch" label="Branch" optional error={errors.branchId}>
                      <NativeSelect value={d.branchId} onChange={setField('branchId')}>
                        <option value="">No specific branch</option>
                        {activeBranches.map((b) => (
                          <option key={b.id} value={b.id}>
                            {b.name}
                          </option>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                  <Field id="rb-bio" label="Short bio" optional hint="Shown on the booking page. Keep it true and simple." error={errors.bio}>
                    <Textarea rows={2} maxLength={300} value={d.bio} onChange={setField('bio')} placeholder="e.g. Ten years cutting in Soweto. Patient with kids." />
                  </Field>
                  <Field id="rb-spec" label="Good at" optional hint="Shown on the booking page." error={errors.specialties}>
                    <Input maxLength={160} value={d.specialties} onChange={setField('specialties')} placeholder="e.g. Fades, line-ups, beard shaping" />
                  </Field>
                  <fieldset className="space-y-4 rounded-lg border border-line bg-paper/60 p-3 sm:p-4">
                    <legend className="flex items-center gap-1.5 px-1 text-sm font-semibold">
                      <Lock className="size-4 text-forest-800" aria-hidden /> Private: managers only
                    </legend>
                    <p className="-mt-1 text-[13px] text-ink-soft">
                      Never shown to customers. Used to reach the barber, or someone close to them, if a house call goes wrong.
                    </p>
                    <Field id="rb-phone" label="Barber’s phone" optional error={errors.contactPhone}>
                      <Input type="tel" autoComplete="off" maxLength={30} value={d.contactPhone} onChange={setField('contactPhone')} />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field id="rb-ecn" label="Emergency contact name" optional error={errors.emergencyContactName}>
                        <Input autoComplete="off" maxLength={80} value={d.emergencyContactName} onChange={setField('emergencyContactName')} />
                      </Field>
                      <Field id="rb-ecp" label="Emergency contact phone" optional error={errors.emergencyContactPhone}>
                        <Input type="tel" autoComplete="off" maxLength={30} value={d.emergencyContactPhone} onChange={setField('emergencyContactPhone')} />
                      </Field>
                    </div>
                  </fieldset>
                </div>
              )}

              {step === 1 &&
                (services.isLoading ? (
                  <ListSkeleton rows={3} />
                ) : services.isError ? (
                  <ErrorState error={services.error} onRetry={() => services.refetch()} />
                ) : list.length === 0 ? (
                  <p className="text-sm text-ink-muted">
                    No services yet.{' '}
                    <Link to="/services" className="font-semibold text-forest-800 hover:underline">
                      Add your services and prices
                    </Link>{' '}
                    first, or carry on and add them to this barber later.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-ink-soft">Tick what this barber does. Leave “Own price” empty to use the shop’s list price.</p>
                    {errors.services && (
                      <p role="alert" className="text-[13px] font-medium text-red-700">
                        {errors.services}
                      </p>
                    )}
                    <ul className="divide-y divide-line rounded-lg border border-line">
                      {list.map((s) => {
                        const on = isOn(s.id)
                        const price = picked[s.id]?.price ?? ''
                        return (
                          <li key={s.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
                            <label htmlFor={`rb-svc-${s.id}`} className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5">
                              <Checkbox id={`rb-svc-${s.id}`} className="mt-0.5" checked={on} onChange={(e) => setPicked((x) => ({ ...x, [s.id]: { on: e.target.checked, price } }))} />
                              <span className="min-w-0">
                                <span className="block font-medium">{s.name}</span>
                                <span className="block text-[12px] text-ink-muted">
                                  List price <Money cents={s.priceCents} /> · {durationLabel(s.durationMinutes)}
                                  {s.allowsHouseCall ? ' · house call OK' : ''}
                                </span>
                              </span>
                            </label>
                            {on && (
                              <div className="w-full pl-7 sm:w-36 sm:pl-0">
                                <Label htmlFor={`rb-price-${s.id}`} className="sr-only">
                                  Own price for {s.name}
                                </Label>
                                <MoneyInput
                                  id={`rb-price-${s.id}`}
                                  placeholder="Own price"
                                  value={price}
                                  aria-invalid={errors[`price-${s.id}`] ? true : undefined}
                                  onChange={(e) => setPicked((x) => ({ ...x, [s.id]: { on: true, price: e.target.value } }))}
                                />
                                {errors[`price-${s.id}`] && (
                                  <p role="alert" className="mt-1 text-[12px] font-medium text-red-700">
                                    {errors[`price-${s.id}`]}
                                  </p>
                                )}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </div>
                ))}

              {step === 2 && (
                <div className="space-y-3">
                  <p className="text-sm text-ink-soft">Customers can only book inside these hours. You or the barber can add split days and time off later.</p>
                  <ul className="divide-y divide-line rounded-lg border border-line">
                    {DAY_ORDER.map((day) => {
                      const r = days[day]
                      return (
                        <li key={day} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
                          <label htmlFor={`rb-day-${day}`} className="flex w-32 cursor-pointer items-center gap-2 text-sm font-semibold">
                            <Checkbox id={`rb-day-${day}`} checked={r.on} onChange={(e) => setDays((x) => ({ ...x, [day]: { ...r, on: e.target.checked } }))} />
                            {WEEKDAY_NAMES[day]}
                          </label>
                          {r.on ? (
                            <div className="flex min-w-0 flex-1 items-center gap-2">
                              <Input
                                type="time"
                                aria-label={`${WEEKDAY_NAMES[day]} start`}
                                className="h-10 min-w-0 flex-1"
                                value={r.start}
                                onChange={(e) => setDays((x) => ({ ...x, [day]: { ...r, start: e.target.value } }))}
                              />
                              <span className="shrink-0 text-ink-muted">to</span>
                              <Input
                                type="time"
                                aria-label={`${WEEKDAY_NAMES[day]} end`}
                                className="h-10 min-w-0 flex-1"
                                value={r.end}
                                onChange={(e) => setDays((x) => ({ ...x, [day]: { ...r, end: e.target.value } }))}
                              />
                            </div>
                          ) : (
                            <span className="text-sm text-ink-muted">Not working</span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                  {errors.hours && (
                    <p role="alert" className="text-[13px] font-medium text-red-700">
                      {errors.hours}
                    </p>
                  )}
                </div>
              )}

              {step === 3 && (
                <div className="space-y-5">
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-line p-3">
                    <Label htmlFor="rb-hc" className="flex items-start gap-2">
                      <Car className="mt-0.5 size-4 shrink-0 text-forest-800" aria-hidden />
                      <span>
                        Does house calls
                        <span className="block text-[12px] font-normal text-ink-muted">Customers need a verified account with their address to book one. The barber checks in during each visit.</span>
                      </span>
                    </Label>
                    <Switch id="rb-hc" checked={houseCalls} onCheckedChange={setHouseCalls} />
                  </div>
                  <div className="space-y-3 rounded-lg border border-line p-3">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="rb-login">
                        Give them a login
                        <span className="block text-[12px] font-normal text-ink-muted">Their own barber screen: status, today’s customers, safety check-ins and photos of their work.</span>
                      </Label>
                      <Switch id="rb-login" checked={giveLogin} onCheckedChange={setGiveLogin} />
                    </div>
                    {giveLogin && (
                      <Field id="rb-email" label="Their email address" hint="They sign up or sign in with this email. You get a link to send them — no email is sent by KasiFlow." error={errors.loginEmail}>
                        <Input type="email" autoComplete="off" maxLength={160} value={email} onChange={(e) => setEmail(e.target.value)} />
                      </Field>
                    )}
                  </div>
                </div>
              )}

              <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-between">
                {step > 0 ? (
                  <Button type="button" variant="outline" onClick={() => go(step - 1)}>
                    <ArrowLeft /> Back
                  </Button>
                ) : (
                  <span />
                )}
                {step < STEPS.length - 1 ? (
                  <Button type="button" onClick={() => go(step + 1)}>
                    Next: {STEPS[step + 1]} <ArrowRight />
                  </Button>
                ) : (
                  <Button type="button" loading={register.isPending} onClick={submit}>
                    <UserPlus /> Register {d.displayName.trim().split(' ')[0] || 'barber'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
