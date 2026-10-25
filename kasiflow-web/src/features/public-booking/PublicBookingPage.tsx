import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BadgeCheck, CalendarCheck, Car, Check, CheckCircle2, LogOut, SearchX, ShieldCheck, Store, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Callout } from '@/components/shared/Callout'
import { Money } from '@/components/shared/Money'
import { CopyButton } from '@/components/shared/CopyButton'
import { DateStrip, SlotPicker } from '@/components/shared/SlotPicker'
import { ServicePeoplePicker, type PersonChoice } from '@/components/shared/ServicePeoplePicker'
import { ErrorState } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatRandShort, todayJhb } from '@/lib/format'
import { HeroPanel } from '@/components/shared/HeroPanel'
import { ShopCover } from '@/features/shops/ShopCover'
import { durationLabel, formatWhen, groupSlots, itemsFromPeople, servicesTotal, type SlotGroup } from '@/lib/barbershop'
import { addressLine, priceFor } from '@/lib/customer'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/AuthProvider'
import { useCustomerAccount } from '@/features/customer/api'
import { OtpSignIn } from '@/features/customer/OtpSignIn'
import { AccountDetailsForm, HouseCallReadiness } from '@/features/customer/AccountForm'
import type { LocationType, PublicBookingCreatedDto } from '@/types/barbershop'
import { BarberCards, ServiceCatalogue } from './Catalogue'
import { PinPicker } from '@/features/map/PinPicker'
import { JoinQueueCard } from '@/features/queue/JoinQueueCard'
import { PublicShell } from './PublicShell'
import { useCreatePublicBooking, usePublicAvailability, usePublicBookingInfo } from './api'

function Section({ n, title, children, id }: { n: number; title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="min-w-0 scroll-mt-4 rounded-xl border border-line bg-surface p-4 shadow-card sm:p-5" aria-labelledby={`step-${n}`}>
      <h3 id={`step-${n}`} className="mb-3 flex items-center gap-2 font-sans text-base font-semibold">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-fg" aria-hidden>
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  )
}

// ---------- Draft (survives the magic-link round trip and a page refresh) ----------
interface Draft {
  people: PersonChoice[]
  staffId: string
  location: LocationType
  date: string
  slotStart: string | null
  note: string
  name: string
  phone: string
}

const draftKey = (slug: string) => `kf-book-draft:${slug}`

function readDraft(slug: string): Partial<Draft> | null {
  try {
    const raw = window.sessionStorage.getItem(draftKey(slug))
    return raw ? (JSON.parse(raw) as Partial<Draft>) : null
  } catch {
    return null
  }
}

function writeDraft(slug: string, d: Draft | null) {
  try {
    if (d) window.sessionStorage.setItem(draftKey(slug), JSON.stringify(d))
    else window.sessionStorage.removeItem(draftKey(slug))
  } catch {
    /* storage blocked: the form still works, it just is not restored */
  }
}

function Done({ slug, created }: { slug: string; created: PublicBookingCreatedDto }) {
  const url = `${window.location.origin}${created.statusPath}`
  const b = created.booking
  return (
    <div className="space-y-4 rounded-lg border border-emerald-200 bg-surface p-5 shadow-card sm:p-6">
      <CheckCircle2 className="size-10 text-emerald-600" aria-hidden />
      <h1 className="text-2xl font-bold">Request sent</h1>
      <p className="text-[15px] text-ink-soft">{b.message}</p>
      <dl className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-ink-muted">Reference</dt>
          <dd className="font-mono text-lg font-semibold">{created.reference}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">When</dt>
          <dd className="font-semibold">{formatWhen(b.startsAt)}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Status</dt>
          <dd className="font-semibold">{b.statusLabel}</dd>
        </div>
        <div>
          <dt className="text-ink-muted">Total</dt>
          <dd className="font-semibold">
            <Money cents={b.totalCents} />
          </dd>
        </div>
      </dl>
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button asChild size="lg">
          <Link to={`/c/bookings/${encodeURIComponent(created.reference)}`}>
            <CalendarCheck /> See it in My bookings
          </Link>
        </Button>
        <Button asChild size="lg" variant="outline">
          <Link to={`/p/${slug}`}>Back to the business</Link>
        </Button>
      </div>
      <details className="rounded-md border border-line bg-paper/60 p-3 text-sm">
        <summary className="cursor-pointer font-semibold">Backup link (works without signing in)</summary>
        <p className="mt-2 text-ink-soft">Anyone with this link can see and change the booking, so keep it to yourself.</p>
        <p className="mt-2 rounded bg-surface px-2 py-1.5 font-mono text-[12px] break-all">{url}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <CopyButton text={url} label="Copy link" />
          <Button asChild size="sm" variant="outline">
            <Link to={created.statusPath}>Open</Link>
          </Button>
        </div>
      </details>
    </div>
  )
}

/**
 * /p/:slug/book — catalogue first (services & prices, the barbers and their work), then the booking request.
 * Sending a request needs a customer verified with a one-time code; house calls also need a complete account.
 */
export function PublicBookingPage() {
  const { slug = '' } = useParams()
  const validSlug = /^[a-z0-9-]{3,80}$/.test(slug)
  const info = usePublicBookingInfo(slug, validSlug)
  const create = useCreatePublicBooking(slug)
  const { session, signOut } = useAuth()
  const account = useCustomerAccount(!!session)
  const i = info.data
  const a = account.data

  const initial = useRef(validSlug ? readDraft(slug) : null).current
  const [people, setPeople] = useState<PersonChoice[]>(initial?.people?.length ? initial.people : [{ label: '', serviceIds: [] }])
  const [staffId, setStaffId] = useState<string>(initial?.staffId ?? '')
  const [location, setLocation] = useState<LocationType>(initial?.location ?? 'in_shop')
  const [date, setDate] = useState(initial?.date && initial.date >= todayJhb() ? initial.date : todayJhb())
  const [slot, setSlot] = useState<SlotGroup | null>(null)
  const pendingSlot = useRef<string | null>(initial?.slotStart ?? null)
  const [name, setName] = useState(initial?.name ?? '')
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [note, setNote] = useState(initial?.note ?? '')
  const [otherAddress, setOtherAddress] = useState(false)
  const [addr, setAddr] = useState({ addressLine: '', suburb: '', town: '', accessNotes: '' })
  const [pin, setPin] = useState<{ lat: number; lng: number } | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [problem, setProblem] = useState<string>()
  const [blocked, setBlocked] = useState<string>()
  const [created, setCreated] = useState<PublicBookingCreatedDto | null>(null)

  useEffect(() => {
    document.title = i ? `Book at ${i.businessName} | KasiFlow SA` : 'Book an appointment | KasiFlow SA'
  }, [i])

  // Fill name and phone from the account once (the customer can still change them for this booking).
  const prefilled = useRef(false)
  useEffect(() => {
    if (!a || prefilled.current) return
    prefilled.current = true
    setName((n) => n || a.fullName || '')
    setPhone((p) => p || a.contactPhone || '')
  }, [a])

  const houseCall = location === 'house_call'
  const staff = useMemo(() => (i?.staff ?? []).filter((s) => !houseCall || s.acceptsHouseCalls), [i, houseCall])
  const chosen = i?.staff.find((s) => s.id === staffId) ?? null
  // A barber who does not do house calls cannot stay selected for one.
  useEffect(() => {
    if (staffId && i && !staff.some((s) => s.id === staffId)) setStaffId('')
  }, [staff, staffId, i])

  const pricedServices = useMemo(() => (i?.services ?? []).map((s) => ({ ...s, priceCents: priceFor(s.id, s.priceCents, chosen?.prices) })), [i, chosen])
  const items = useMemo(() => itemsFromPeople(people), [people])
  const serviceIds = useMemo(() => items.map((x) => x.serviceId), [items])
  const totals = servicesTotal(people, pricedServices)
  const avail = usePublicAvailability(slug, { date, serviceIds, staffId: staffId || null, locationType: location }, !!i)
  const groups = useMemo(() => groupSlots(avail.data?.slots ?? [], staffId || null), [avail.data, staffId])
  const slotKey = `${date}|${staffId}|${location}|${serviceIds.join(',')}`
  useEffect(() => setSlot(null), [slotKey])
  useEffect(() => {
    if (!pendingSlot.current || groups.length === 0) return
    const g = groups.find((x) => x.startsAt === pendingSlot.current)
    pendingSlot.current = null
    if (g) setSlot(g)
  }, [groups])

  useEffect(() => {
    if (!validSlug || created) return
    writeDraft(slug, { people, staffId, location, date, slotStart: slot?.startsAt ?? pendingSlot.current, note, name, phone })
  }, [validSlug, created, slug, people, staffId, location, date, slot, note, name, phone])

  const notFound = !validSlug || (info.error instanceof ApiError && info.error.status === 404)
  const bookingUrl = `/p/${slug}/book`

  const scrollTo = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })

  const toggleService = (id: string) =>
    setPeople((ps) => ps.map((p, idx) => (idx === 0 ? { ...p, serviceIds: p.serviceIds.includes(id) ? p.serviceIds.filter((x) => x !== id) : [...p.serviceIds, id] } : p)))

  const submit = () => {
    const e: Record<string, string> = {}
    if (items.length === 0) e.items = 'Choose at least one service.'
    if (!slot) e.startsAt = 'Choose a time.'
    if (!houseCall && name.trim().length < 2) e.customerName = 'Enter your name so the shop knows who to expect.'
    if (houseCall && otherAddress && !addr.addressLine.trim()) e.houseCall = 'Enter the address for this visit, or use the one in your account.'
    setErrors(e)
    setProblem(undefined)
    setBlocked(undefined)
    if (Object.keys(e).length || !slot) {
      setProblem(Object.values(e)[0])
      return
    }
    create.mutate(
      {
        items,
        staffId: staffId || null,
        startsAt: slot.startsAt,
        locationType: location,
        houseCall:
          houseCall && otherAddress
            ? {
                addressLine: addr.addressLine.trim(),
                suburb: addr.suburb.trim() || null,
                town: addr.town.trim() || null,
                accessNotes: addr.accessNotes.trim() || null,
                latitude: pin?.lat ?? null,
                longitude: pin?.lng ?? null,
              }
            : houseCall && pin && a?.addressLine
              ? {
                  // The account address with the customer's pin (the API only keeps a pin sent with an address).
                  addressLine: a.addressLine,
                  suburb: a.suburb,
                  town: a.town,
                  accessNotes: a.accessNotes,
                  latitude: pin.lat,
                  longitude: pin.lng,
                }
              : null,
        customerName: houseCall ? null : name.trim(),
        customerPhone: houseCall ? null : phone.trim() || null,
        customerNote: note.trim() || null,
      },
      {
        onSuccess: (r) => {
          writeDraft(slug, null)
          setCreated(r)
          window.scrollTo({ top: 0 })
        },
        onError: (err) => {
          if (err instanceof ApiError && err.status === 401) {
            setProblem('Your sign-in has expired. Verify your email again to send the request.')
            void signOut()
            return
          }
          if (err instanceof ApiError && err.status === 403 && houseCall) {
            setBlocked(err.userMessage)
            return
          }
          if (err instanceof ApiError && err.status === 409) void avail.refetch()
          if (err instanceof ApiError && err.fieldError('account')) void account.refetch()
          if (err instanceof ApiError && Object.keys(err.errors).length) {
            const fe = Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]]))
            setErrors(fe)
            setProblem(Object.values(fe)[0])
          } else setProblem(errorMessage(err))
        },
      },
    )
  }

  if (notFound)
    return (
      <PublicShell>
        <div className="rounded-lg border border-line bg-surface px-6 py-14 text-center shadow-card">
          <SearchX className="mx-auto mb-4 size-10 text-forest-800" aria-hidden />
          <h1 className="text-2xl font-bold">Booking page not found</h1>
          <p className="mx-auto mt-2 max-w-sm text-[15px] text-ink-soft">This business does not take online bookings here, or the link is wrong. Check the link with the business.</p>
        </div>
      </PublicShell>
    )

  if (created)
    return (
      <PublicShell>
        <Done slug={slug} created={created} />
      </PublicShell>
    )

  const n0 = i?.houseCallsEnabled ? 1 : 0

  // ---------- "Your details" step ----------
  let details: ReactNode
  if (!session) {
    details = (
      <div className="space-y-3">
        <div className="flex gap-3 rounded-md bg-forest-50 p-3 text-sm text-ink">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-forest-800" aria-hidden />
          <p>
            <span className="font-semibold">Verify to book.</span> Shops only take requests from people who confirmed their email with a one-time code. No password,
            no profile to fill in. Your choices above are kept.
          </p>
        </div>
        <OtpSignIn idPrefix="pb-otp" redirectTo={`${window.location.origin}${bookingUrl}`} />
      </div>
    )
  } else if (account.isLoading) {
    details = <Skeleton className="h-28" />
  } else if (account.isError || !a) {
    details = (
      <Callout tone="warning" title="We could not load your customer account">
        {errorMessage(account.error)}{' '}
        <button type="button" className="cursor-pointer font-semibold underline" onClick={() => void signOut()}>
          Sign out and verify again
        </button>
      </Callout>
    )
  } else {
    details = (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-paper px-3 py-2 text-sm">
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <BadgeCheck className="size-4 shrink-0 text-emerald-700" aria-hidden />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              Booking as <strong>{a.verifiedContact}</strong>
            </span>
          </span>
          <button type="button" onClick={() => void signOut()} className="inline-flex cursor-pointer items-center gap-1 text-[13px] font-semibold text-forest-800 hover:underline">
            <LogOut className="size-3.5" aria-hidden /> Not you?
          </button>
        </div>

        {houseCall ? (
          a.houseCallReady ? (
            <div className="space-y-3">
              <dl className="grid gap-2 rounded-md border border-line p-3 text-sm sm:grid-cols-2">
                <div>
                  <dt className="text-ink-muted">Name</dt>
                  <dd className="font-medium">{a.fullName}</dd>
                </div>
                <div>
                  <dt className="text-ink-muted">Phone for the barber</dt>
                  <dd className="font-medium">{a.contactPhone}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-ink-muted">Address on your account</dt>
                  <dd className="font-medium [overflow-wrap:anywhere]">{addressLine(a)}</dd>
                  {a.accessNotes && <dd className="text-[13px] text-ink-soft">{a.accessNotes}</dd>}
                </div>
              </dl>
              <p className="text-[13px] text-ink-muted">
                Wrong details?{' '}
                <Link to={`/c/account?next=${encodeURIComponent(bookingUrl)}`} className="font-semibold text-forest-800 hover:underline">
                  Edit them in your account
                </Link>
                .
              </p>
              <label htmlFor="pb-other" className="flex cursor-pointer items-start gap-2.5 text-sm font-medium">
                <Checkbox id="pb-other" className="mt-0.5" checked={otherAddress} onChange={(e) => setOtherAddress(e.target.checked)} />
                <span>This visit is at a different address</span>
              </label>
              {otherAddress && (
                <div className="space-y-3 rounded-md border border-line p-3">
                  <Field id="pb-addr" label="Street address for this visit" error={errors.houseCall ?? errors.addressLine}>
                    <Input autoComplete="street-address" maxLength={200} value={addr.addressLine} onChange={(e) => setAddr({ ...addr, addressLine: e.target.value })} />
                  </Field>
                  <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                    <Field id="pb-suburb" label="Suburb / section" optional>
                      <Input maxLength={80} value={addr.suburb} onChange={(e) => setAddr({ ...addr, suburb: e.target.value })} />
                    </Field>
                    <Field id="pb-town" label="Town" optional>
                      <Input maxLength={80} value={addr.town} onChange={(e) => setAddr({ ...addr, town: e.target.value })} />
                    </Field>
                  </div>
                  <Field id="pb-access" label="How to find you" optional>
                    <Input maxLength={300} value={addr.accessNotes} onChange={(e) => setAddr({ ...addr, accessNotes: e.target.value })} placeholder="Gate colour, landmark…" />
                  </Field>
                </div>
              )}
              <PinPicker value={pin} onChange={setPin} />
              <p className="text-[12px] text-ink-muted">Your address and pin are shared only with this business, for this visit.</p>
            </div>
          ) : (
            <div className="space-y-4">
              <Callout tone="warning" title="House calls need a few more details">
                So the barber knows who to expect and where, and can reach you on the day. You fill this in once.
              </Callout>
              <HouseCallReadiness account={a} />
              <AccountDetailsForm key={a.memberSince + a.missingForHouseCall.join('|')} account={a} idPrefix="pb-acc" submitLabel="Save my details" />
              <p className="text-[13px] text-ink-muted">
                Prefer a full page?{' '}
                <Link to={`/c/account?next=${encodeURIComponent(bookingUrl)}`} className="font-semibold text-forest-800 hover:underline">
                  Open my account
                </Link>{' '}
                (your choices here are kept).
              </p>
            </div>
          )
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pb-name" label="Your name" error={errors.customerName}>
              <Input autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field id="pb-phone" label="Phone" optional hint="So the shop can reach you about this booking." error={errors.customerPhone}>
              <Input type="tel" autoComplete="tel" maxLength={30} value={phone} onChange={(e) => setPhone(e.target.value)} />
            </Field>
          </div>
        )}

        {blocked && (
          <Callout
            tone="warning"
            title="House call not available"
            action={
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setBlocked(undefined)
                  setLocation('in_shop')
                  scrollTo('book')
                }}
              >
                <Store /> Book at the shop
              </Button>
            }
          >
            {blocked}
          </Callout>
        )}

        <Field id="pb-note" label="Note to the barber" optional error={errors.customerNote}>
          <Textarea rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Skin fade, keep the top long" />
        </Field>
      </div>
    )
  }

  const canSend = !!session && !!a && (!houseCall || a.houseCallReady)
  const fromCents = i && i.services.length > 0 ? Math.min(...i.services.map((x) => x.priceCents)) : null
  const freeNow = i?.staff.filter((x) => x.availableNow).length ?? 0
  const chosenNames = people.flatMap((p) => p.serviceIds.map((id) => pricedServices.find((x) => x.id === id)?.name ?? '')).filter(Boolean)

  return (
    <PublicShell wide back={{ to: '/c/shops', label: 'All shops' }} className="pb-28 lg:pb-8">
      {info.isLoading ? (
        <div className="space-y-4" aria-busy aria-label="Loading">
          <Skeleton className="h-9 w-2/3" />
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : info.isError ? (
        <ErrorState error={info.error} onRetry={() => info.refetch()} title="Could not load the booking page" />
      ) : i ? (
        <div className="space-y-8">
          <HeroPanel as="header">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
              <ShopCover name={i.businessName} src={null} className="hidden size-28 shrink-0 rounded-xl sm:flex [&>span]:text-4xl" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-gold">Prices, barbers and booking</p>
                <h1 className="mt-1 text-[2rem] leading-tight font-bold text-white sm:text-[2.6rem] [overflow-wrap:anywhere]">{i.businessName}</h1>
                <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[14px] font-medium text-cream">
                  {fromCents != null && <li>From {formatRandShort(fromCents)}</li>}
                  <li className="inline-flex items-center gap-1.5">
                    <Users className="size-4" aria-hidden /> {i.staff.length} {i.staff.length === 1 ? 'barber' : 'barbers'}
                  </li>
                  {freeNow > 0 && (
                    <li className="inline-flex items-center gap-1.5 text-white">
                      <span className="size-2.5 rounded-full bg-emerald-brand" aria-hidden /> {freeNow} available now
                    </li>
                  )}
                  {i.houseCallsEnabled && (
                    <li className="inline-flex items-center gap-1.5">
                      <Car className="size-4" aria-hidden /> House calls
                    </li>
                  )}
                </ul>
              </div>
            </div>
            <p className="mt-4 max-w-3xl text-[14px] leading-relaxed text-cream/90">{i.disclaimer}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button variant="accent" size="lg" onClick={() => scrollTo('book')}>
                Book a time
              </Button>
              <Button variant="outline" size="lg" className="border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white" onClick={() => scrollTo('barbers')}>
                See the barbers
              </Button>
              <Button asChild variant="ghost" size="lg" className="text-cream hover:bg-white/10 hover:text-white">
                <Link to={`/p/${slug}`}>Shop profile</Link>
              </Button>
            </div>
          </HeroPanel>

          <JoinQueueCard slug={slug} services={i.services} staff={i.staff} />

          <div className="grid min-w-0 gap-8 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
          <div className="min-w-0 space-y-8">
          <section aria-labelledby="prices-h" id="prices" className="scroll-mt-4">
            <h2 id="prices-h" className="text-2xl font-bold">
              Services & prices
            </h2>
            <p className="mt-1 mb-4 text-sm text-ink-soft">List prices from the shop. Some barbers charge their own price for some services; it is shown on their card.</p>
            <ServiceCatalogue services={i.services} selected={people[0]?.serviceIds ?? []} onToggle={toggleService} houseCallsEnabled={i.houseCallsEnabled} />
          </section>

          <section aria-labelledby="barbers-h" id="barbers" className="scroll-mt-4">
            <h2 id="barbers-h" className="text-2xl font-bold">
              Our barbers
            </h2>
            <p className="mt-1 mb-4 text-sm text-ink-soft">Photos are of real work, shared by each barber with their customer’s permission. Statuses are set by the barbers and may be out of date.</p>
            <BarberCards
              staff={i.staff}
              services={i.services}
              selectedId={staffId}
              onBook={(id) => {
                const s = i.staff.find((x) => x.id === id)
                if (s && houseCall && !s.acceptsHouseCalls) setLocation('in_shop')
                setStaffId(id)
                scrollTo('book')
              }}
            />
          </section>

          <section aria-labelledby="book-h" id="book" className="scroll-mt-4 space-y-4">
            <div>
              <h2 id="book-h" className="text-2xl font-bold">
                Book a time
              </h2>
              <p className="mt-1 text-sm text-ink-soft">
                {i.requiresConfirmation ? 'You send a request; it is only booked once the shop confirms it.' : 'You send a request and see its status in My bookings.'}
              </p>
            </div>

            {i.houseCallsEnabled && (
              <Section n={1} title="Where">
                <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Where">
                  {(
                    [
                      ['in_shop', 'At the shop', Store],
                      ['house_call', 'At my place', Car],
                    ] as const
                  ).map(([k, label, Icon]) => (
                    <button
                      key={k}
                      type="button"
                      role="radio"
                      aria-checked={location === k}
                      onClick={() => {
                        setLocation(k)
                        setBlocked(undefined)
                      }}
                      className={cn(
                        'flex h-14 cursor-pointer items-center justify-center gap-2 rounded-md border text-[15px] font-semibold',
                        location === k ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong bg-surface hover:bg-forest-50',
                      )}
                    >
                      <Icon className="size-5" aria-hidden /> {label}
                    </button>
                  ))}
                </div>
                {houseCall && (
                  <div className="mt-3 space-y-2 text-[13px] text-ink-soft">
                    <p className="rounded-md bg-paper px-3 py-2">
                      <span className="font-semibold text-ink">Travel fee: </span>
                      {i.travelFeePolicy} The barber confirms the distance; if that changes the fee, it is proposed to you first and you can decline.
                    </p>
                    <p className="rounded-md bg-paper px-3 py-2">
                      <span className="font-semibold text-ink">For the barber’s safety, </span>
                      house calls need a verified account with your name, a phone number and your address, and agreeing to the house-call terms. You add these once.
                    </p>
                  </div>
                )}
              </Section>
            )}

            <Section n={n0 + 1} title="Services">
              <ServicePeoplePicker services={pricedServices} people={people} onChange={setPeople} houseCall={houseCall} />
              {chosen && pricedServices.some((s, idx) => s.priceCents !== i.services[idx]?.priceCents) && (
                <p className="mt-2 text-[12px] text-ink-muted">Prices shown are {chosen.displayName.split(' ')[0]}’s.</p>
              )}
              {errors.items && (
                <p role="alert" className="mt-2 text-[13px] font-medium text-red-700">
                  {errors.items}
                </p>
              )}
            </Section>

            <Section n={n0 + 2} title="Barber">
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Barber">
                {[{ id: '', displayName: 'Any barber', roleTitle: 'First one free', statusLabel: '', availableNow: false }, ...staff].map((s) => (
                  <button
                    key={s.id || 'any'}
                    type="button"
                    role="radio"
                    aria-checked={staffId === s.id}
                    onClick={() => setStaffId(s.id)}
                    className={cn(
                      'flex min-h-14 cursor-pointer items-center justify-between gap-2 rounded-md border px-3 py-2 text-left',
                      staffId === s.id ? 'border-forest-800 bg-forest-50 ring-1 ring-forest-800' : 'border-line-strong bg-surface hover:bg-forest-50/60',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{s.displayName}</span>
                      <span className="block text-[12px] text-ink-muted">{s.roleTitle}</span>
                    </span>
                    {s.statusLabel && (
                      <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold', s.availableNow ? 'bg-emerald-50 text-emerald-800' : 'bg-paper text-ink-muted')}>
                        {s.statusLabel}
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {houseCall && staff.length < i.staff.length && <p className="mt-2 text-[12px] text-ink-muted">Only barbers who do house calls are listed.</p>}
            </Section>

            <Section n={n0 + 3} title="Day and time">
              <div className="space-y-3">
                <DateStrip value={date} onChange={setDate} id="pb-date" maxDays={i.horizonDays} />
                {serviceIds.length === 0 ? (
                  <p className="text-[13px] text-ink-muted">Choose a service first to see free times.</p>
                ) : (
                  <SlotPicker groups={groups} loading={avail.isLoading} error={avail.error} notes={avail.data?.notes} value={slot?.startsAt ?? null} onChange={setSlot} />
                )}
                {errors.startsAt && (
                  <p role="alert" className="text-[13px] font-medium text-red-700">
                    {errors.startsAt}
                  </p>
                )}
              </div>
            </Section>

            <Section n={n0 + 4} title={session ? 'Your details' : 'Verify to book'} id="details">
              {details}
            </Section>
          </section>
          </div>

          <aside className="min-w-0 lg:sticky lg:top-4" aria-label="Booking summary">
            <section id="summary" aria-live="polite" aria-labelledby="summary-h" className="scroll-mt-4 space-y-3 rounded-2xl border border-forest-800/20 bg-surface p-4 shadow-raised sm:p-5">
              <h2 id="summary-h" className="text-lg font-bold">
                Your booking
              </h2>
              {chosenNames.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {chosenNames.map((n, idx) => (
                    <li key={`${n}-${idx}`} className="flex items-center gap-2">
                      <Check className="size-4 shrink-0 text-emerald-700" aria-hidden /> {n}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-ink-muted">No service chosen yet. Tap Add on a service.</p>
              )}
              <p className="text-sm text-ink-soft">
                With <span className="font-semibold text-ink">{chosen ? chosen.displayName : 'any barber'}</span> · {houseCall ? 'house call' : 'at the shop'}
              </p>
              <div className="flex justify-between gap-2 text-sm">
                <span>
                  {totals.count} {totals.count === 1 ? 'service' : 'services'}
                  {totals.durationMinutes > 0 && ` · about ${durationLabel(totals.durationMinutes)}`}
                </span>
                <Money cents={totals.totalCents} />
              </div>
              {houseCall && <p className="text-[13px] text-ink-soft">Plus the travel fee: {i.travelFeePolicy}</p>}
              <div className="flex justify-between border-t border-line pt-2 text-lg font-bold">
                <span>{houseCall ? 'Services total' : 'Total'}</span>
                <Money cents={totals.totalCents} />
              </div>
              <p className={cn('text-sm', slot ? 'font-semibold' : 'text-ink-muted')}>{slot ? `Requested time: ${formatWhen(slot.startsAt)}` : 'No time chosen yet.'}</p>
              <p className="text-[13px] text-ink-soft">This is a request until {i.businessName} confirms it. You can follow it in My bookings.</p>
              {problem && (
                <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
                  {problem}
                </p>
              )}
              {canSend ? (
                <Button size="lg" className="h-12 w-full" loading={create.isPending} onClick={submit}>
                  Send booking request
                </Button>
              ) : (
                <Button size="lg" variant="outline" className="h-auto min-h-12 w-full py-2 whitespace-normal" onClick={() => scrollTo('details')}>
                  {!session ? 'Verify your email to send the request' : 'Complete your details to send the request'}
                </Button>
              )}
            </section>
          </aside>
          </div>
        </div>
      ) : null}
      {i && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-raised backdrop-blur lg:hidden">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] text-ink-muted">
                {totals.count === 0 ? 'No service chosen yet' : `${totals.count} ${totals.count === 1 ? 'service' : 'services'}${slot ? ` · ${formatWhen(slot.startsAt)}` : ''}`}
              </p>
              <p className="font-display text-xl leading-tight font-bold">
                <Money cents={totals.totalCents} />
              </p>
            </div>
            <Button size="lg" className="shrink-0" onClick={() => scrollTo(totals.count === 0 ? 'prices' : slot ? 'summary' : 'book')}>
              {totals.count === 0 ? 'Choose a service' : slot ? 'Review & send' : 'Pick a time'}
            </Button>
          </div>
        </div>
      )}
    </PublicShell>
  )
}
