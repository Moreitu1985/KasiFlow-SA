import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BadgeCheck, Footprints, Hourglass, LogOut, Ticket, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ChoiceChips } from '@/components/shared/Segmented'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatRandShort } from '@/lib/format'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCustomerAccount } from '@/features/customer/api'
import { OtpSignIn } from '@/features/customer/OtpSignIn'
import type { PublicServiceDto, PublicStaffDto } from '@/types/barbershop'
import { useJoinQueue, usePublicQueue } from './api'

/**
 * "Walk in now": the shop's live queue at a glance (no names) and joining it from the phone. Joining needs the same
 * one-time-code sign-in as booking; the customer then gets a ticket page with their number and a live wait estimate.
 */
export function JoinQueueCard({ slug, services, staff }: { slug: string; services: PublicServiceDto[]; staff: PublicStaffDto[] }) {
  const snap = usePublicQueue(slug)
  const { session, signOut } = useAuth()
  const account = useCustomerAccount(!!session)
  const join = useJoinQueue(slug)
  const navigate = useNavigate()
  const [open, setOpen] = useState(() => typeof window !== 'undefined' && window.location.hash === '#queue')
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [pref, setPref] = useState('')
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (account.data?.fullName) setName((n) => n || account.data?.fullName || '')
  }, [account.data])

  const s = snap.data
  if (snap.isError || (s && !s.enabled)) return null

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setError(undefined)
    if (name.trim().length < 2) return setError('Enter your name so the barber can call you.')
    join.mutate(
      { customerName: name.trim(), serviceIds: picked, preferredStaffId: pref || null },
      {
        onSuccess: (r) => navigate(r.statusPath),
        onError: (err) => {
          if (err instanceof ApiError && err.status === 401) {
            setError('Your sign-in has expired. Verify your email again to join.')
            void signOut()
            return
          }
          setError(errorMessage(err))
        },
      },
    )
  }

  return (
    <section id="queue" aria-labelledby="queue-h" className="scroll-mt-4 overflow-hidden rounded-2xl border-2 border-emerald-brand/60 bg-surface shadow-raised">
      <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:p-5">
        <span className="pole-turn hidden h-16 w-5 shrink-0 rounded-full ring-2 ring-line sm:block" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 id="queue-h" className="flex items-center gap-2 text-xl font-bold">
            <Footprints className="size-5 text-ochre" aria-hidden /> Walk in now — join the queue
          </h2>
          {s ? (
            <ul className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[14px]">
              <li className="inline-flex items-center gap-1.5 font-semibold">
                <Users className="size-4 text-ink-muted" aria-hidden /> {s.waiting === 0 ? 'Nobody waiting' : `${s.waiting} waiting`}
              </li>
              <li className="inline-flex items-center gap-1.5 text-ink-soft">
                <Hourglass className="size-4 text-ink-muted" aria-hidden /> {s.nextWaitLabel}
              </li>
              <li className="text-ink-muted">
                {s.barbersWorking} {s.barbersWorking === 1 ? 'barber' : 'barbers'} working
              </li>
            </ul>
          ) : (
            <Skeleton className="mt-2 h-4 w-56" />
          )}
          <p className="mt-1 text-[12px] text-ink-muted">Get a number on your phone and come in when it is nearly your turn. Wait times are estimates.</p>
        </div>
        {!open && (
          <Button size="lg" variant="accent" className="shrink-0" onClick={() => setOpen(true)}>
            <Ticket /> Join the queue
          </Button>
        )}
      </div>
      {open && (
        <div className="animate-rise-in border-t border-line bg-paper/60 p-4 sm:p-5">
          {!session ? (
            <div className="space-y-3">
              <p className="text-sm">
                <span className="font-semibold">Verify to join.</span> A one-time code to your email — no password. You come straight back here.
              </p>
              <OtpSignIn idPrefix="q-otp" redirectTo={`${window.location.origin}/p/${slug}/book#queue`} />
            </div>
          ) : account.isLoading ? (
            <Skeleton className="h-28" />
          ) : (
            <form onSubmit={submit} className="space-y-4" noValidate>
              {account.data && (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-surface px-3 py-2 text-sm">
                  <span className="inline-flex min-w-0 items-center gap-1.5">
                    <BadgeCheck className="size-4 shrink-0 text-emerald-700" aria-hidden />
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      Joining as <strong>{account.data.verifiedContact}</strong>
                    </span>
                  </span>
                  <button type="button" onClick={() => void signOut()} className="inline-flex min-h-11 cursor-pointer items-center gap-1 text-[13px] font-semibold text-forest-800 hover:underline">
                    <LogOut className="size-3.5" aria-hidden /> Not you?
                  </button>
                </div>
              )}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field id="q-name" label="Your name" hint="The barber calls you by this name and your number.">
                  <Input autoComplete="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                </Field>
                <Field id="q-pref" label="Barber" optional>
                  <NativeSelect value={pref} onChange={(e) => setPref(e.target.value)}>
                    <option value="">Any barber (shortest wait)</option>
                    {staff.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.displayName}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              </div>
              {services.length > 0 && (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-semibold">
                    What are you having? <span className="font-normal text-ink-muted">(optional, makes the estimate better)</span>
                  </legend>
                  <ChoiceChips
                    label="Services"
                    options={services.map((x) => ({ value: x.id, label: x.name, hint: formatRandShort(x.priceCents) }))}
                    selected={picked}
                    onToggle={(id) => setPicked((p) => (p.includes(id) ? p.filter((v) => v !== id) : [...p, id].slice(0, 6)))}
                  />
                </fieldset>
              )}
              {error && (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                  {error}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" size="lg" variant="accent" loading={join.isPending}>
                  <Ticket /> Get my number
                </Button>
                <Button type="button" size="lg" variant="ghost" onClick={() => setOpen(false)}>
                  Not now
                </Button>
              </div>
              <p className="text-[12px] text-ink-muted">Prices are paid at the shop. You can leave the queue from your ticket at any time.</p>
            </form>
          )}
        </div>
      )}
    </section>
  )
}
