import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { ImageOff } from 'lucide-react'
import { boundsFor, DEFAULT_CENTER, isValidLatLng, roundCoord, type LatLng } from '@/lib/geo'
import { cn } from '@/lib/utils'

export type PinKind = 'visit' | 'shared' | 'pick' | 'alert'

export interface MapPin {
  id: string
  lat: number
  lng: number
  kind: PinKind
  /** Shown on hover/tap (or always, with `labels="always"`). */
  label: string
  /** One or two characters inside the pin (e.g. a number). */
  glyph?: string
  onClick?: () => void
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

/** Brass-ringed charcoal teardrop for a visit address; red when a check-in is late or help was asked; pole stripes for "your pin". */
function pinIcon(kind: PinKind, glyph?: string): L.DivIcon {
  if (kind === 'shared')
    return L.divIcon({
      className: 'kf-pin',
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      tooltipAnchor: [0, -14],
      html: `<svg width="26" height="26" viewBox="0 0 26 26" aria-hidden="true"><circle cx="13" cy="13" r="12" fill="#1d3557" fill-opacity="0.22"/><circle cx="13" cy="13" r="7.5" fill="#1d3557" stroke="#ffffff" stroke-width="2.5"/></svg>`,
    })
  const fill = kind === 'alert' ? '#b91c1c' : '#18181b'
  const ring = kind === 'alert' ? '#fecaca' : '#d4a64a'
  const inner =
    kind === 'pick'
      ? `<clipPath id="kfc"><circle cx="17" cy="16" r="8"/></clipPath><g clip-path="url(#kfc)"><rect x="8" y="7" width="18" height="18" fill="#fff"/><path d="M0 18 22 2v4L0 22zM4 28 26 12v4L4 32z" fill="#c8102e"/><path d="M2 22 24 6v2L2 24z" fill="#1d3557"/></g>`
      : `<circle cx="17" cy="16" r="8.5" fill="#ffffff"/><text x="17" y="20" text-anchor="middle" font-family="Public Sans Variable, system-ui, sans-serif" font-size="11" font-weight="800" fill="${fill}">${esc(glyph ?? '')}</text>`
  return L.divIcon({
    className: 'kf-pin',
    iconSize: [34, 44],
    iconAnchor: [17, 43],
    tooltipAnchor: [0, -40],
    html: `<svg width="34" height="44" viewBox="0 0 34 44" aria-hidden="true" style="filter:drop-shadow(0 3px 4px rgb(0 0 0 / .35))"><path d="M17 42.5C17 42.5 2 26.6 2 16.5a15 15 0 0 1 30 0C32 26.6 17 42.5 17 42.5Z" fill="${fill}" stroke="${ring}" stroke-width="2.5"/>${inner}</svg>`,
  })
}

const ATTRIBUTION = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'

/**
 * Plain Leaflet with OpenStreetMap tiles in a small React wrapper. Tiles come from tile.openstreetmap.org at runtime;
 * if they cannot load, the pins still show on a plain background with a short note. In picker mode, a tap places the
 * pin and dragging adjusts it.
 */
export function LeafletMap({
  pins,
  height = 320,
  className,
  label,
  labels = 'hover',
  picker,
  onPick,
  fitKey,
}: {
  pins: MapPin[]
  height?: number | string
  className?: string
  /** Accessible name of the map region. */
  label: string
  labels?: 'hover' | 'always'
  /** Picker mode: tap the map to place the pin, drag to adjust. */
  picker?: boolean
  onPick?: (p: LatLng) => void
  /** Change this to re-fit the view to the pins (defaults to the pins' positions). */
  fitKey?: string
}) {
  const el = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const layer = useRef<L.LayerGroup | null>(null)
  const pickRef = useRef(onPick)
  pickRef.current = onPick
  const [tilesFailed, setTilesFailed] = useState(false)

  // Create the map once.
  useEffect(() => {
    if (!el.current) return
    const m = L.map(el.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
    m.attributionControl.setPrefix(false)
    let ok = 0
    let failed = 0
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: ATTRIBUTION, crossOrigin: true })
      .on('tileload', () => {
        ok++
        setTilesFailed(false)
      })
      .on('tileerror', () => {
        failed++
        if (ok === 0 && failed >= 1) setTilesFailed(true)
      })
      .addTo(m)
    m.setView([DEFAULT_CENTER.lat, DEFAULT_CENTER.lng], 11)
    layer.current = L.layerGroup().addTo(m)
    map.current = m
    // The container may be sized after mount (dialogs, tabs): let Leaflet measure again.
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => m.invalidateSize()) : null
    ro?.observe(el.current)
    return () => {
      ro?.disconnect()
      m.remove()
      map.current = null
      layer.current = null
    }
  }, [])

  // Picker: tap to place.
  useEffect(() => {
    const m = map.current
    if (!m || !picker) return
    const click = (e: L.LeafletMouseEvent) => pickRef.current?.({ lat: roundCoord(e.latlng.lat), lng: roundCoord(e.latlng.lng) })
    m.on('click', click)
    return () => {
      m.off('click', click)
    }
  }, [picker])

  // Draw the pins.
  useEffect(() => {
    const g = layer.current
    if (!g) return
    g.clearLayers()
    for (const p of pins) {
      if (!isValidLatLng(p.lat, p.lng)) continue
      const draggable = picker && p.kind === 'pick'
      const mk = L.marker([p.lat, p.lng], { icon: pinIcon(p.kind, p.glyph), draggable, keyboard: true, title: p.label, alt: p.label, riseOnHover: true, zIndexOffset: p.kind === 'shared' ? 1000 : 500 })
      mk.bindTooltip(esc(p.label), { direction: 'top', permanent: labels === 'always', opacity: 1 })
      if (p.onClick) mk.on('click', p.onClick)
      if (draggable)
        mk.on('dragend', () => {
          const ll = mk.getLatLng()
          pickRef.current?.({ lat: roundCoord(ll.lat), lng: roundCoord(ll.lng) })
        })
      mk.addTo(g)
    }
  }, [pins, picker, labels])

  // Fit the view when the set of pins changes (not on every small drag).
  const key = fitKey ?? pins.map((p) => `${p.id}:${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|')
  useEffect(() => {
    const m = map.current
    if (!m) return
    const b = boundsFor(pins.map((p) => ({ lat: p.lat, lng: p.lng })))
    if (!b) return
    m.fitBounds(
      [
        [b.south, b.west],
        [b.north, b.east],
      ],
      { maxZoom: 16, animate: false },
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return (
    <div className={cn('relative isolate overflow-hidden rounded-xl border border-line', className)} style={{ height }}>
      <div
        ref={el}
        role="region"
        aria-label={label}
        className="kf-map size-full"
      />
      {tilesFailed && (
        <p className="pointer-events-none absolute top-2 right-2 z-[500] inline-flex max-w-[calc(100%-4rem)] items-center gap-1.5 rounded-md border border-line bg-surface/95 px-2 py-1 text-[12px] font-medium text-ink-soft shadow-card">
          <ImageOff className="size-3.5 shrink-0" aria-hidden /> Map tiles couldn’t load — the pins are still in the right place.
        </p>
      )}
    </div>
  )
}

export default LeafletMap
