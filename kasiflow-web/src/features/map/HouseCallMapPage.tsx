import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Car, ChevronRight, Hourglass, LifeBuoy, MapPinOff, Navigation, RefreshCw, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Callout } from '@/components/shared/Callout'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { formatDayLabel, formatTime } from '@/lib/barbershop'
import { directionsUrl } from '@/lib/geo'
import { todayJhb } from '@/lib/format'
import { cn } from '@/lib/utils'
import { RoleHeader } from '@/features/access/RoleHeader'
import type { MapHouseCallDto } from '@/types/pro'
import { useHouseCallMap } from './api'
import { LazyMap } from './LazyMap'
import type { MapPin } from './LeafletMap'

function Legend() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-ink-soft" aria-label="Map legend">
      <li className="inline-flex items-center gap-2">
        <svg width="16" height="20" viewBox="0 0 34 44" aria-hidden>
          <path d="M17 42.5C17 42.5 2 26.6 2 16.5a15 15 0 0 1 30 0C32 26.6 17 42.5 17 42.5Z" fill="#18181b" stroke="#d4a64a" strokeWidth="3" />
        </svg>
        Visit address (customer’s pin)
      </li>
      <li className="inline-flex items-center gap-2">
        <svg width="16" height="20" viewBox="0 0 34 44" aria-hidden>
          <path d="M17 42.5C17 42.5 2 26.6 2 16.5a15 15 0 0 1 30 0C32 26.6 17 42.5 17 42.5Z" fill="#b91c1c" stroke="#fecaca" strokeWidth="3" />
        </svg>
        Late check-in or help asked
      </li>
      <li className="inline-flex items-center gap-2">
        <svg width="16" height="16" viewBox="0 0 26 26" aria-hidden>
          <circle cx="13" cy="13" r="12" fill="#1d3557" fillOpacity="0.25" />
          <circle cx="13" cy="13" r="7.5" fill="#1d3557" stroke="#fff" strokeWidth="2.5" />
        </svg>
        Spot a barber chose to share
      </li>
    </ul>
  )
}

function VisitItem({ v, n, active, onSelect }: { v: MapHouseCallDto; n: number; active: boolean; onSelect: () => void }) {
  const alarm = v.helpActive || v.overdue
  const target = v.address ?? v.lastShared
  return (
    <li
      id={`visit-${v.bookingId}`}
      className={cn(
        'scroll-mt-24 rounded-2xl border bg-surface p-3.5 shadow-card transition-shadow',
        alarm ? 'border-2 border-red-400' : 'border-line',
        active && 'ring-2 ring-emerald-brand',
      )}
    >
      <button type="button" onClick={onSelect} className="flex w-full cursor-pointer items-start gap-3 text-left">
        <span
          className={cn('flex size-9 shrink-0 items-center justify-center rounded-full font-display text-[15px] font-bold', alarm ? 'bg-red-700 text-white' : 'bg-primary text-primary-fg')}
          aria-hidden
        >
          {v.address ? n : '–'}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold">
            {formatTime(v.startsAt)} · {v.customerName}
          </span>
          <span className="block truncate text-[13px] text-ink-muted">
            {v.area ?? 'Area not given'} · {v.staffName ?? 'No barber yet'} · <span className="font-mono">{v.reference}</span>
          </span>
          <span className="mt-1.5 flex flex-wrap gap-1.5">
            <Badge variant={v.stage === 'returned' ? 'success' : 'info'}>{v.stageLabel}</Badge>
            {v.helpActive && (
              <Badge variant="critical">
                <LifeBuoy aria-hidden /> Help requested
              </Badge>
            )}
            {v.overdue && !v.helpActive && (
              <Badge variant="critical">
                <Hourglass aria-hidden /> Check-in late
              </Badge>
            )}
            {!v.address && (
              <Badge variant="neutral">
                <MapPinOff aria-hidden /> No pin
              </Badge>
            )}
          </span>
          {v.lastShared && (
            <span className="mt-1.5 block text-[12px] text-ink-soft">
              {v.lastShared.label}
              {v.lastShared.at ? ` at ${formatTime(v.lastShared.at)}` : ''}
            </span>
          )}
        </span>
      </button>
      <div className="mt-2.5 flex flex-wrap gap-2 pl-12">
        <Button asChild size="sm" variant="outline">
          <Link to={`/bookings/${v.bookingId}`}>
            Open booking <ChevronRight />
          </Link>
        </Button>
        {target && (
          <Button asChild size="sm" variant="ghost">
            <a href={directionsUrl(target.latitude, target.longitude)} target="_blank" rel="noopener noreferrer">
              <Navigation /> Directions
            </a>
          </Button>
        )}
      </div>
    </li>
  )
}

/**
 * /map — today's house calls on a map: the pins customers dropped for the visit address and the spots barbers chose to
 * share with a check-in. Nobody is tracked; there are no live positions.
 */
export function HouseCallMapPage() {
  const [date, setDate] = useState(todayJhb())
  const q = useHouseCallMap(date === todayJhb() ? undefined : date)
  const m = q.data
  const [active, setActive] = useState<string | null>(null)

  const numbered = useMemo(() => {
    let i = 0
    return (m?.visits ?? []).map((v) => ({ v, n: v.address ? ++i : 0 }))
  }, [m])

  const select = (id: string) => {
    setActive(id)
    document.getElementById(`visit-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }

  const pins = useMemo<MapPin[]>(() => {
    const out: MapPin[] = []
    for (const { v, n } of numbered) {
      if (v.address)
        out.push({
          id: `a-${v.bookingId}`,
          lat: v.address.latitude,
          lng: v.address.longitude,
          kind: v.helpActive || v.overdue ? 'alert' : 'visit',
          glyph: String(n),
          label: `${n}. ${formatTime(v.startsAt)} ${v.customerName}${v.area ? ` · ${v.area}` : ''}`,
          onClick: () => select(v.bookingId),
        })
      if (v.lastShared)
        out.push({
          id: `s-${v.bookingId}`,
          lat: v.lastShared.latitude,
          lng: v.lastShared.longitude,
          kind: 'shared',
          label: `${v.lastShared.label}${v.lastShared.at ? ` · ${formatTime(v.lastShared.at)}` : ''}`,
          onClick: () => select(v.bookingId),
        })
    }
    return out
  }, [numbered])

  return (
    <div className="space-y-6">
      <RoleHeader
        title="House-call map"
        description="Where today’s house calls are, from the pins customers dropped and the spots barbers chose to share when checking in."
        actions={
          <div className="flex items-end gap-2">
            <div>
              <Label htmlFor="map-date">Day</Label>
              <Input id="map-date" type="date" className="mt-1.5 w-44" value={date} onChange={(e) => setDate(e.target.value || todayJhb())} />
            </div>
            <Button variant="outline" size="icon" loading={q.isFetching && !q.isLoading} onClick={() => q.refetch()} aria-label="Refresh">
              {!(q.isFetching && !q.isLoading) && <RefreshCw />}
            </Button>
          </div>
        }
      />

      {q.isLoading ? (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Skeleton className="h-[420px] rounded-xl" />
          <Skeleton className="h-64 rounded-2xl" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load the map" />
      ) : m ? (
        <>
          <Callout tone="neutral" title="No tracking">
            {m.note}
          </Callout>
          {m.visits.length === 0 ? (
            <EmptyState icon={Car} title={`No house calls on ${formatDayLabel(m.date)}`} description="When a house call is booked for this day, its pin shows here — if the customer dropped one." />
          ) : (
            <div className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)] lg:items-start">
              <div className="min-w-0 space-y-3 lg:sticky lg:top-20">
                {pins.length > 0 ? (
                  <LazyMap pins={pins} height="min(62vh, 520px)" label={`Map of house calls on ${formatDayLabel(m.date)}`} />
                ) : (
                  <div className="flex h-56 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-surface text-center">
                    <MapPinOff className="size-6 text-ink-muted" aria-hidden />
                    <p className="max-w-xs text-sm text-ink-muted">None of these visits has a map pin yet. Customers can drop one when they book.</p>
                  </div>
                )}
                <Legend />
              </div>
              <section aria-label="House calls" className="min-w-0 space-y-3">
                <h2 className="flex items-center gap-2 text-lg font-bold">
                  <ShieldCheck className="size-5 text-forest-800" aria-hidden /> {formatDayLabel(m.date)} · {m.visits.length} {m.visits.length === 1 ? 'visit' : 'visits'}
                </h2>
                {m.withoutPin > 0 && (
                  <p className="text-[13px] text-ink-muted">
                    {m.withoutPin} {m.withoutPin === 1 ? 'visit has' : 'visits have'} no map pin — use the address on the booking.
                  </p>
                )}
                <ul className="stagger space-y-3">
                  {numbered.map(({ v, n }) => (
                    <VisitItem key={v.bookingId} v={v} n={n} active={active === v.bookingId} onSelect={() => setActive(v.bookingId)} />
                  ))}
                </ul>
              </section>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
