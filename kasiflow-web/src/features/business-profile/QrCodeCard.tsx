import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { CalendarPlus, Download, ExternalLink, Store } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CopyButton } from '@/components/shared/CopyButton'
import { cn } from '@/lib/utils'

const QR_COLOURS = { dark: '#0b2a1f', light: '#ffffff' }

/** QR code (SVG on screen, PNG download) for the public booking page or profile. Contains only the public link. */
export function QrCodeCard({ slug, businessName, published }: { slug: string; businessName: string; published: boolean }) {
  const [target, setTarget] = useState<'book' | 'profile'>('book')
  const path = target === 'book' ? `/p/${slug}/book` : `/p/${slug}`
  const url = `${window.location.origin}${path}`
  const [svg, setSvg] = useState<string | null>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let alive = true
    setSvg(null)
    QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 2, color: QR_COLOURS })
      .then((s) => alive && setSvg(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`))
      .catch(() => alive && setError(true))
    return () => {
      alive = false
    }
  }, [url])

  const download = async () => {
    const png = await QRCode.toDataURL(url, { errorCorrectionLevel: 'M', margin: 4, width: 1024, color: QR_COLOURS })
    const a = document.createElement('a')
    a.href = png
    a.download = `${slug}-${target === 'book' ? 'booking' : 'profile'}-qr.png`
    document.body.appendChild(a)
    a.click()
    a.remove()
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Booking link & QR code</CardTitle>
        <CardDescription>Print the QR code for your mirror or counter, or share the link on WhatsApp. It contains only your public link.</CardDescription>
      </CardHeader>
      <CardContent>
        {!published && (
          <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-900">Your profile is not published yet, so these links show “not found” until you publish it below.</p>
        )}
        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="flex shrink-0 flex-col items-center gap-2">
            <div className="rounded-lg border border-line bg-surface p-2">
              {svg ? (
                <img src={svg} alt={`QR code for ${businessName}’s ${target === 'book' ? 'booking page' : 'profile'}: ${url}`} className="size-44" />
              ) : error ? (
                <p className="flex size-44 items-center justify-center text-center text-[13px] text-red-700">Could not draw the QR code.</p>
              ) : (
                <Skeleton className="size-44" />
              )}
            </div>
            <Button size="sm" variant="outline" onClick={() => void download()} disabled={!svg}>
              <Download /> Download PNG
            </Button>
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="inline-flex rounded-md border border-line-strong p-0.5" role="group" aria-label="What the QR code opens">
              {(
                [
                  ['book', 'Booking page', CalendarPlus],
                  ['profile', 'Profile page', Store],
                ] as const
              ).map(([k, label, Icon]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={target === k}
                  onClick={() => setTarget(k)}
                  className={cn('inline-flex h-8 cursor-pointer items-center gap-1.5 rounded px-3 text-[13px] font-semibold', target === k ? 'bg-primary text-primary-fg' : 'text-ink-soft hover:bg-forest-50')}
                >
                  <Icon className="size-4" aria-hidden /> {label}
                </button>
              ))}
            </div>
            <p className="rounded-md bg-paper px-3 py-2 font-mono text-[13px] break-all">{url}</p>
            <div className="flex flex-wrap gap-2">
              <CopyButton text={url} label="Copy link" />
              <Button asChild size="sm" variant="outline">
                <a href={path} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> Open
                </a>
              </Button>
            </div>
            <p className="text-[13px] text-ink-muted">
              Customers can request a time, choose a barber and ask for a house call. Bookings stay requests until your team confirms them, unless you switched on
              automatic confirmation in Settings.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
