import { useState } from 'react'
import { Car, Check, ChevronLeft, ChevronRight, Clock, ImageOff, Plus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Money } from '@/components/shared/Money'
import { Initials } from '@/components/shared/HeroPanel'
import { durationLabel } from '@/lib/barbershop'
import { groupCatalogue, priceDifferences } from '@/lib/customer'
import { cn } from '@/lib/utils'
import type { PublicPhotoDto, PublicServiceDto, PublicStaffDto } from '@/types/barbershop'
import { publicPhotoUrl } from './api'

/** "Services & prices": the shop's public list, grouped by category. Tapping "Add" puts the service in the booking. */
export function ServiceCatalogue({
  services,
  selected,
  onToggle,
  houseCallsEnabled,
}: {
  services: PublicServiceDto[]
  selected: readonly string[]
  onToggle: (serviceId: string) => void
  houseCallsEnabled: boolean
}) {
  const groups = groupCatalogue(services)
  if (services.length === 0) return <p className="text-sm text-ink-muted">This shop has not listed any services for online booking yet.</p>
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <div key={g.category}>
          <h3 className="mb-2.5 font-sans text-[15px] font-semibold text-ink-soft">{g.category}</h3>
          <ul className="grid min-w-0 gap-2.5 sm:grid-cols-2">
            {g.items.map((s) => {
              const on = selected.includes(s.id)
              return (
                <li
                  key={s.id}
                  className={cn(
                    'flex min-w-0 flex-col gap-3 rounded-xl border bg-surface p-4 shadow-card transition-colors',
                    on ? 'border-forest-800 ring-1 ring-forest-800' : 'border-line',
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold [overflow-wrap:anywhere]">{s.name}</p>
                      <p className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-ink-muted">
                        <Clock className="size-3.5" aria-hidden /> about {durationLabel(s.durationMinutes)}
                      </p>
                    </div>
                    <Money cents={s.priceCents} className="shrink-0 font-display text-xl font-bold text-heading" />
                  </div>
                  {s.description && <p className="text-[13px] leading-snug text-ink-soft">{s.description}</p>}
                  <div className="mt-auto flex items-center justify-between gap-2">
                    {houseCallsEnabled && s.allowsHouseCall ? (
                      <Badge variant="outline" className="font-medium">
                        <Car aria-hidden /> Also as a house call
                      </Badge>
                    ) : (
                      <span />
                    )}
                    <Button
                      type="button"
                      variant={on ? 'default' : 'outline'}
                      aria-pressed={on}
                      aria-label={on ? `${s.name} added to your booking. Remove` : `Add ${s.name} to your booking`}
                      onClick={() => onToggle(s.id)}
                    >
                      {on ? <Check aria-hidden /> : <Plus aria-hidden />}
                      {on ? 'Added' : 'Add'}
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      ))}
    </div>
  )
}

function Lightbox({ staff, photos, index, services, onIndex, onClose }: { staff: PublicStaffDto; photos: PublicPhotoDto[]; index: number; services: PublicServiceDto[]; onIndex: (i: number) => void; onClose: () => void }) {
  const p = photos[index]
  const service = p?.serviceId ? services.find((s) => s.id === p.serviceId)?.name : null
  return (
    <Dialog open={!!p} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{staff.displayName}’s work</DialogTitle>
          <DialogDescription>
            Photo {index + 1} of {photos.length}
            {service ? ` · ${service}` : ''}
          </DialogDescription>
        </DialogHeader>
        {p && (
          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-4">
            <img
              src={publicPhotoUrl(p.url)}
              alt={p.caption ?? `${staff.displayName}’s work, photo ${index + 1}`}
              className="mx-auto max-h-[60dvh] w-auto max-w-full rounded-md bg-paper object-contain"
            />
            {p.caption && <p className="text-center text-sm text-ink-soft">{p.caption}</p>}
            {photos.length > 1 && (
              <div className="flex justify-between gap-2">
                <Button type="button" variant="outline" onClick={() => onIndex((index - 1 + photos.length) % photos.length)}>
                  <ChevronLeft aria-hidden /> Previous
                </Button>
                <Button type="button" variant="outline" onClick={() => onIndex((index + 1) % photos.length)}>
                  Next <ChevronRight aria-hidden />
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

function BarberCard({ s, services, selected, onBook }: { s: PublicStaffDto; services: PublicServiceDto[]; selected: boolean; onBook: () => void }) {
  const [open, setOpen] = useState<number | null>(null)
  const photos = s.photos ?? []
  const diffs = priceDifferences(s.prices, services)
  const firstName = s.displayName.split(' ')[0]
  return (
    <li className={cn('flex min-w-0 flex-col gap-3 rounded-xl border bg-surface p-4 shadow-card sm:p-5', selected ? 'border-forest-800 ring-1 ring-forest-800' : 'border-line')}>
      <div className="flex items-start gap-3">
        <Initials name={s.displayName} className={cn('size-12 text-lg', s.availableNow && 'bg-emerald-100 text-emerald-900')} />
        <div className="min-w-0 flex-1">
          <p className="font-display text-lg leading-tight font-semibold [overflow-wrap:anywhere]">{s.displayName}</p>
          <p className="text-[13px] text-ink-muted">{s.roleTitle}</p>
          <span
            className={cn(
              'mt-1 inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-[12px] font-semibold',
              s.availableNow ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-line bg-paper text-ink-soft',
            )}
          >
            <span className={cn('size-2 rounded-full', s.availableNow ? 'bg-emerald-500' : 'bg-ink-muted/50')} aria-hidden />
            {s.statusLabel}
          </span>
        </div>
      </div>
      {s.bio && <p className="text-sm leading-relaxed text-ink-soft">{s.bio}</p>}
      {(s.specialties || s.acceptsHouseCalls) && (
        <p className="flex flex-wrap items-center gap-1.5 text-[13px]">
          {s.specialties && (
            <span className="text-ink-soft">
              <span className="font-semibold text-ink">Good at:</span> {s.specialties}
            </span>
          )}
          {s.acceptsHouseCalls && (
            <Badge variant="outline" className="font-medium">
              <Car aria-hidden /> Does house calls
            </Badge>
          )}
        </p>
      )}
      {diffs.length > 0 && (
        <div className="rounded-md bg-paper px-3 py-2 text-[13px]">
          <p className="font-semibold">{firstName}’s own prices</p>
          <ul className="mt-1 space-y-0.5">
            {diffs.map((d) => (
              <li key={d.serviceId} className="flex justify-between gap-2">
                <span className="min-w-0">{d.name}</span>
                <span className="shrink-0">
                  <Money cents={d.priceCents} className="font-semibold" />{' '}
                  <span className="text-ink-muted">
                    (list <Money cents={d.listPriceCents} />)
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div>
        <p className="mb-1.5 text-[13px] font-semibold">Their work</p>
        {photos.length === 0 ? (
          <p className="flex items-center gap-2 rounded-md border border-dashed border-line-strong px-3 py-3 text-[13px] text-ink-muted">
            <ImageOff className="size-4 shrink-0" aria-hidden /> No photos yet
          </p>
        ) : (
          <ul className="flex gap-2 overflow-x-auto pb-1" aria-label={`Photos of ${s.displayName}’s work`}>
            {photos.map((p, i) => (
              <li key={p.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setOpen(i)}
                  className="block size-20 cursor-pointer overflow-hidden rounded-md border border-line bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-brand sm:size-24"
                  aria-label={`Open photo ${i + 1} of ${photos.length}${p.caption ? `: ${p.caption}` : ''}`}
                >
                  <img src={publicPhotoUrl(p.url)} alt="" loading="lazy" className="size-full object-cover" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button type="button" variant={selected ? 'default' : 'outline'} className="mt-auto" aria-pressed={selected} onClick={onBook}>
        {selected ? <Check aria-hidden /> : null}
        {selected ? `Booking with ${firstName}` : `Book with ${firstName}`}
      </Button>
      {open !== null && <Lightbox staff={s} photos={photos} index={open} services={services} onIndex={setOpen} onClose={() => setOpen(null)} />}
    </li>
  )
}

/** "Our barbers": who works here, what they are good at, their own prices and photos of their work. No ratings. */
export function BarberCards({ staff, services, selectedId, onBook }: { staff: PublicStaffDto[]; services: PublicServiceDto[]; selectedId: string; onBook: (id: string) => void }) {
  if (staff.length === 0) return <p className="text-sm text-ink-muted">No barbers are taking online bookings right now.</p>
  return (
    <ul className="grid min-w-0 gap-3 sm:grid-cols-2">
      {staff.map((s) => (
        <BarberCard key={s.id} s={s} services={services} selected={selectedId === s.id} onBook={() => onBook(s.id)} />
      ))}
    </ul>
  )
}
