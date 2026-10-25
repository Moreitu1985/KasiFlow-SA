import { useState } from 'react'
import { LocateFixed, MapPin, MapPinned, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { roundCoord, type LatLng } from '@/lib/geo'
import { LazyMap } from './LazyMap'

/**
 * Optional "Drop a pin for the barber": tap the map to place the pin, drag it to adjust, or use the phone's location
 * once (it asks first). The pin is sent only with this booking, to this shop.
 */
export function PinPicker({ value, onChange }: { value: LatLng | null; onChange: (p: LatLng | null) => void }) {
  const [open, setOpen] = useState(!!value)
  const [locating, setLocating] = useState(false)
  const [geoError, setGeoError] = useState<string>()

  const locate = () => {
    if (!('geolocation' in navigator)) return setGeoError('This browser cannot share your location. Tap the map instead.')
    setLocating(true)
    setGeoError(undefined)
    navigator.geolocation.getCurrentPosition(
      (p) => {
        onChange({ lat: roundCoord(p.coords.latitude), lng: roundCoord(p.coords.longitude) })
        setLocating(false)
      },
      () => {
        setGeoError('Could not get your location. Tap the map where the barber should come instead.')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    )
  }

  if (!open)
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface px-3.5 py-2.5 text-left transition-colors hover:bg-tint"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-tint-strong text-heading" aria-hidden>
          <MapPinned className="size-4" />
        </span>
        <span>
          <span className="block text-sm font-semibold">Drop a pin for the barber (optional)</span>
          <span className="block text-[12px] text-ink-muted">Helps them find your gate when street names are not enough.</span>
        </span>
      </button>
    )

  return (
    <div className="space-y-2.5 rounded-xl border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold">Drop a pin for the barber</p>
        <Button type="button" variant="outline" size="sm" loading={locating} onClick={locate}>
          {!locating && <LocateFixed />} Use my location
        </Button>
      </div>
      <LazyMap
        picker
        onPick={onChange}
        pins={value ? [{ id: 'pick', lat: value.lat, lng: value.lng, kind: 'pick', label: 'Your pin — drag to adjust' }] : []}
        height={260}
        label="Map: tap to drop a pin where the barber should come"
      />
      <p className="text-[12px] leading-snug text-ink-muted">
        Tap the map where the barber should come, then drag the pin to adjust. “Use my location” asks your phone once. The pin is sent only with this booking, to this shop.
      </p>
      {geoError && <p className="text-[13px] text-amber-800">{geoError}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {value ? (
          <>
            <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-2.5 py-1.5 text-[13px] font-medium text-emerald-900">
              <MapPin className="size-4" aria-hidden /> Pin added ({value.lat.toFixed(4)}, {value.lng.toFixed(4)})
            </span>
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              <X /> Remove pin
            </Button>
          </>
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setOpen(false)
              setGeoError(undefined)
            }}
          >
            No pin
          </Button>
        )}
      </div>
    </div>
  )
}
