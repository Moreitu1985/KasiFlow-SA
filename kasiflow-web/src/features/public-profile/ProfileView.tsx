import { Clock, Mail, MapPin, Phone, Store } from 'lucide-react'
import { PROVINCES } from '@/lib/labels'
import type { PublicProfileDto } from '@/types/api'

export function toList(v: string | string[] | null | undefined): string[] {
  if (!v) return []
  if (Array.isArray(v)) return v.map((s) => s.trim()).filter(Boolean)
  return v
    .split(/\r?\n|,(?![^(]*\))/)
    .map((s) => s.replace(/^[-•*]\s*/, '').trim())
    .filter(Boolean)
}

/** The public business card. Shows only fields the API returned. */
export function ProfileView({ p }: { p: PublicProfileDto }) {
  const items = toList(p.productsServices)
  const place = [p.town, p.province ? PROVINCES[p.province] : null].filter(Boolean).join(', ')
  const tel = p.phone?.replace(/[^\d+]/g, '')
  return (
    <article className="overflow-hidden rounded-lg border border-line bg-surface shadow-card">
      {p.imageUrl ? (
        <img src={p.imageUrl} alt={`${p.businessName}`} className="aspect-[16/9] w-full bg-forest-50 object-cover" referrerPolicy="no-referrer" />
      ) : (
        <div className="kasi-band h-4" aria-hidden />
      )}
      <div className="p-6 sm:p-8">
        {p.category && <p className="text-sm font-semibold text-ochre">{p.category}</p>}
        <h1 className="mt-1 text-3xl leading-tight font-bold sm:text-4xl">{p.businessName}</h1>
        {place && (
          <p className="mt-2 inline-flex items-center gap-1.5 text-[15px] text-ink-soft">
            <MapPin className="size-4" aria-hidden /> {place}
          </p>
        )}
        {p.description && <p className="mt-5 max-w-prose text-[16px] leading-relaxed whitespace-pre-wrap text-ink">{p.description}</p>}

        {(tel || p.email) && (
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            {tel && (
              <a href={`tel:${tel}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-primary px-5 font-semibold text-primary-fg hover:bg-primary-hover">
                <Phone className="size-4" aria-hidden /> Call {p.phone}
              </a>
            )}
            {p.email && (
              <a href={`mailto:${p.email}`} className="inline-flex h-12 items-center justify-center gap-2 rounded-md border border-line-strong px-5 font-semibold text-ink hover:bg-forest-50">
                <Mail className="size-4" aria-hidden /> Email
              </a>
            )}
          </div>
        )}

        <dl className="mt-8 grid gap-6 border-t border-line pt-6 sm:grid-cols-2">
          {items.length > 0 && (
            <div className="sm:col-span-2">
              <dt className="flex items-center gap-2 text-sm font-semibold">
                <Store className="size-4 text-forest-800" aria-hidden /> Products & services
              </dt>
              <dd className="mt-2 flex flex-wrap gap-2">
                {items.map((i) => (
                  <span key={i} className="rounded-md border border-line bg-paper px-2.5 py-1 text-sm">
                    {i}
                  </span>
                ))}
              </dd>
            </div>
          )}
          {p.openingHours && (
            <div>
              <dt className="flex items-center gap-2 text-sm font-semibold">
                <Clock className="size-4 text-forest-800" aria-hidden /> Opening hours
              </dt>
              <dd className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">{p.openingHours}</dd>
            </div>
          )}
          {p.serviceArea && (
            <div>
              <dt className="flex items-center gap-2 text-sm font-semibold">
                <MapPin className="size-4 text-forest-800" aria-hidden /> Service area
              </dt>
              <dd className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">{p.serviceArea}</dd>
            </div>
          )}
        </dl>
      </div>
    </article>
  )
}
