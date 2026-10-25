import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Car, Footprints, MapPin, Search, SearchX, Store, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { HeroPanel } from '@/components/shared/HeroPanel'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { formatRandShort } from '@/lib/format'
import { AppBadge } from '@/layouts/shell'
import { useCustomerExperience } from '@/features/customer/useCustomerExperience'
import type { ShopCardDto } from '@/types/customer'
import { coverUrl, usePublicShops } from './api'
import { ShopCover } from './ShopCover'
import { usePublicQueue } from '@/features/queue/api'

function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

function Fact({ icon: Icon, children, tone }: { icon: typeof Users; children: React.ReactNode; tone?: 'good' }) {
  return (
    <li className={tone === 'good' ? 'inline-flex items-center gap-1.5 text-emerald-800' : 'inline-flex items-center gap-1.5 text-ink-soft'}>
      <Icon className="size-4 shrink-0" aria-hidden />
      {children}
    </li>
  )
}

/** Walk-in queue at a glance (one small anonymous request per shop card). */
function QueueLine({ slug }: { slug: string }) {
  const q = usePublicQueue(slug)
  const s = q.data
  if (!s || !s.enabled) return null
  return (
    <Link
      to={`/p/${slug}/book#queue`}
      className="flex min-h-11 items-center gap-2 rounded-lg border border-emerald-brand/40 bg-ochre-soft px-3 py-2 text-[13px] transition-colors hover:border-emerald-brand"
    >
      <Footprints className="size-4 shrink-0 text-ochre" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="font-semibold">Walk-ins: {s.waiting === 0 ? 'nobody waiting' : `${s.waiting} waiting`}</span>
        <span className="whitespace-nowrap text-ink-soft"> · {s.nextWaitLabel}</span>
      </span>
      <span className="shrink-0 font-semibold text-forest-800">Join</span>
    </Link>
  )
}

function ShopCard({ s, showQueue }: { s: ShopCardDto; showQueue: boolean }) {
  return (
    <li className="lift flex min-w-0 flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <ShopCover name={s.name} src={coverUrl(s.coverPhotoUrl)} className="aspect-[16/9] w-full" />
      <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-xl leading-tight font-bold [overflow-wrap:anywhere]">{s.name}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-ink-muted">
              {s.town && (
                <span className="inline-flex items-center gap-1">
                  <MapPin className="size-3.5" aria-hidden /> {s.town}
                </span>
              )}
              {s.category && <span>{s.category}</span>}
            </p>
          </div>
          {s.priceFromCents != null && (
            <p className="shrink-0 text-right leading-tight">
              <span className="block text-[12px] text-ink-muted">From</span>
              <span className="font-display text-xl font-bold text-heading tabular">{formatRandShort(s.priceFromCents)}</span>
            </p>
          )}
        </div>
        {s.description && <p className="line-clamp-2 text-sm leading-relaxed text-ink-soft">{s.description}</p>}
        <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] font-medium">
          <Fact icon={Users}>
            {s.barberCount} {s.barberCount === 1 ? 'barber' : 'barbers'}
          </Fact>
          {s.availableNow > 0 ? (
            <li className="inline-flex items-center gap-1.5 text-emerald-800">
              <span className="size-2.5 rounded-full bg-emerald-500" aria-hidden />
              {s.availableNow} available now
            </li>
          ) : (
            <li className="inline-flex items-center gap-1.5 text-ink-muted">
              <span className="size-2.5 rounded-full bg-ink-muted/50" aria-hidden />
              Nobody marked free right now
            </li>
          )}
          {s.houseCalls && <Fact icon={Car}>House calls</Fact>}
          <Fact icon={Store}>
            {s.serviceCount} {s.serviceCount === 1 ? 'service' : 'services'}
          </Fact>
        </ul>
        {showQueue && <QueueLine slug={s.slug} />}
        <Button asChild size="lg" className="mt-auto w-full">
          <Link to={s.bookPath}>View prices & book</Link>
        </Button>
      </div>
    </li>
  )
}

/** /c/shops — the customer catalogue: every published shop, searchable by name, town or kind of shop. Works signed out. */
export function ShopsPage() {
  const [term, setTerm] = useState('')
  const q = usePublicShops(useDebounced(term))
  const { experience, who } = useCustomerExperience()
  const shops = q.data ?? []

  useEffect(() => {
    document.title = 'Find a barber | KasiFlow SA'
  }, [])

  return (
    <div className="space-y-6">
      <HeroPanel as="header">
        <AppBadge experience={experience} who={who} tone="dark" />
        <h1 className="mt-3 text-[2rem] leading-tight font-bold text-white sm:text-[2.6rem]">Find a barber</h1>
        <p className="mt-1.5 max-w-xl text-[15px] leading-relaxed text-cream">
          See each shop’s prices, its barbers and photos of their work, then book a chair or a house call. Everything here is published by the shops themselves.
        </p>
        <form role="search" className="mt-5 max-w-xl" onSubmit={(e) => e.preventDefault()}>
          <label htmlFor="shop-search" className="mb-1.5 block text-sm font-semibold text-white">
            Search by shop name, town or kind of shop
          </label>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-5 -translate-y-1/2 text-ink-muted" aria-hidden />
            <Input
              id="shop-search"
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="e.g. Soweto, fade, Thato"
              className="h-13 rounded-xl border-0 pr-12 pl-11 text-base shadow-raised"
              autoComplete="off"
            />
            {term && (
              <button
                type="button"
                onClick={() => setTerm('')}
                className="absolute top-1/2 right-1.5 flex size-10 -translate-y-1/2 cursor-pointer items-center justify-center rounded-lg text-ink-muted hover:bg-forest-50"
                aria-label="Clear search"
              >
                <X className="size-5" aria-hidden />
              </button>
            )}
          </div>
        </form>
      </HeroPanel>

      {q.isLoading ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-busy aria-label="Loading shops">
          {Array.from({ length: 3 }).map((_, i) => (
            <li key={i} className="overflow-hidden rounded-2xl border border-line bg-surface">
              <Skeleton className="aspect-[16/9] w-full rounded-none" />
              <div className="space-y-3 p-5">
                <Skeleton className="h-6 w-2/3" />
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-12 w-full" />
              </div>
            </li>
          ))}
        </ul>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load the shops" />
      ) : shops.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title={term.trim() ? `No shops match “${term.trim()}”` : 'No shops are taking online bookings yet'}
          description={term.trim() ? 'Try the town or suburb instead, or a shorter word.' : 'If your barber uses KasiFlow, ask them for their booking QR code.'}
          action={
            term.trim() && (
              <Button variant="outline" onClick={() => setTerm('')}>
                Show all shops
              </Button>
            )
          }
        />
      ) : (
        <section aria-labelledby="results-h" className="space-y-3">
          <h2 id="results-h" className="text-sm font-semibold text-ink-muted" aria-live="polite">
            {shops.length} {shops.length === 1 ? 'shop' : 'shops'}
            {term.trim() ? ` for “${term.trim()}”` : ' taking bookings'}
          </h2>
          <ul className="stagger grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shops.map((s, i) => (
              <ShopCard key={s.slug} s={s} showQueue={i < 10} />
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
