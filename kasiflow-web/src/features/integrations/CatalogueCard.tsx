import { CheckCircle2, CircleSlash, ExternalLink, Plug } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AVAILABILITY_LABELS, CONNECTION_STATUS_LABELS, connectionTone } from '@/lib/automation'
import type { ConnectionDto, ConnectionStatus, ProviderCardDto } from '@/types/automation'

function AvailabilityBadge({ card }: { card: ProviderCardDto }) {
  if (card.availability === 'available') return <Badge variant="success">{AVAILABILITY_LABELS.available}</Badge>
  if (card.availability === 'sandbox_only')
    return (
      <Badge variant="forest" className="border-ochre bg-ochre text-forest-950">
        {AVAILABILITY_LABELS.sandbox_only}
      </Badge>
    )
  return <Badge variant="neutral">{card.key === 'yoco' ? 'Planned — awaiting provider access' : AVAILABILITY_LABELS.planned}</Badge>
}

export function CatalogueCard({
  card,
  connection,
  canManage,
  onConnect,
}: {
  card: ProviderCardDto
  connection: ConnectionDto | undefined
  canManage: boolean
  onConnect: () => void
}) {
  const headingId = `provider-${card.key}`
  return (
    <Card className="flex min-w-0 flex-col" aria-labelledby={headingId}>
      <CardContent className="flex flex-1 flex-col pt-5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={headingId} className="font-sans text-base font-semibold">
            {card.name}
          </h3>
          <AvailabilityBadge card={card} />
          {connection && (
            <Badge variant={connectionTone(connection.status, connection.health.state)}>
              {CONNECTION_STATUS_LABELS[connection.status as ConnectionStatus] ?? connection.status}
            </Badge>
          )}
        </div>
        <p className="mt-1.5 text-sm leading-relaxed text-ink-soft">{card.summary}</p>
        {card.notes && <p className="mt-1.5 text-[13px] text-ink-muted">{card.notes}</p>}

        <h4 className="mt-4 font-sans text-[13px] font-semibold text-ink">What it can do</h4>
        <ul className="mt-1.5 space-y-1.5">
          {card.capabilities.map((cap) => (
            <li key={cap.key} className="flex gap-2 text-[13px]">
              {cap.supported ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-700" aria-label="Supported" />
              ) : (
                <CircleSlash className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-label="Not supported" />
              )}
              <span className={cap.supported ? '' : 'text-ink-muted'}>
                {cap.label}
                {cap.note && <span className="block text-[12px] text-ink-muted">{cap.note}</span>}
              </span>
            </li>
          ))}
        </ul>

        <details className="mt-4 group">
          <summary className="cursor-pointer text-[13px] font-semibold text-forest-800">Setup steps</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-[13px] text-ink-soft">
            {card.setupSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </details>

        <div className="mt-auto flex flex-wrap items-center gap-2 pt-4">
          {canManage && card.canConnect && !connection && (
            <Button size="sm" onClick={onConnect}>
              <Plug /> Connect
            </Button>
          )}
          {card.docsUrl && (
            <Button asChild variant="link" size="sm">
              <a href={card.docsUrl} target="_blank" rel="noreferrer noopener">
                Provider docs <ExternalLink aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
