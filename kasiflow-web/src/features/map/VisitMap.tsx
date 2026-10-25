import { Navigation } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatTime } from '@/lib/barbershop'
import { directionsUrl, isValidLatLng } from '@/lib/geo'
import { LazyMap } from './LazyMap'
import type { MapPin } from './LeafletMap'

export interface SharedPoint {
  id: string
  lat: number
  lng: number
  label: string
  at?: string | null
}

/**
 * A small map for one house call: the visit address (the customer's pin) and any spots the barber chose to share with
 * a check-in, plus a "Get directions" link. Nothing is tracked.
 */
export function VisitMap({ address, shared = [], height = 220, title }: { address?: { lat: number; lng: number } | null; shared?: SharedPoint[]; height?: number; title: string }) {
  const pins: MapPin[] = []
  const hasAddress = !!address && isValidLatLng(address.lat, address.lng)
  if (hasAddress) pins.push({ id: 'address', lat: address!.lat, lng: address!.lng, kind: 'visit', glyph: '', label: 'Visit address (customer’s pin)' })
  for (const p of shared)
    if (isValidLatLng(p.lat, p.lng)) pins.push({ id: p.id, lat: p.lat, lng: p.lng, kind: 'shared', label: `${p.label}${p.at ? ` · ${formatTime(p.at)}` : ''}` })
  if (pins.length === 0) return null
  const target = hasAddress ? address! : shared[shared.length - 1]
  return (
    <div className="space-y-2">
      <LazyMap pins={pins} height={height} label={title} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[12px] text-ink-muted">
          {hasAddress ? 'Pin dropped by the customer' : 'No address pin'}
          {shared.length > 0 && ` · ${shared.length} ${shared.length === 1 ? 'spot' : 'spots'} shared with check-ins`}. Nobody is tracked.
        </p>
        {target && (
          <Button asChild size="sm" variant="outline">
            <a href={directionsUrl(target.lat, target.lng)} target="_blank" rel="noopener noreferrer">
              <Navigation /> Get directions
            </a>
          </Button>
        )}
      </div>
    </div>
  )
}
