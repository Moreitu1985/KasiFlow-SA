import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { CalendarDays, CheckCircle2, ChevronDown, EyeOff, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAccess } from '@/features/access/useAccess'
import { Badge } from '@/components/ui/badge'
import { SeverityBadge } from '@/components/shared/Badges'
import { Money } from '@/components/shared/Money'
import { errorMessage } from '@/lib/apiClient'
import { formatDate, formatDateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { EvidenceItem, RecommendationDto, RecommendationStatus } from '@/types/api'
import { useUpdateRecommendation } from './api'

export function evidenceLink(e: Pick<EvidenceItem, 'sourceType' | 'sourceId'>): string | null {
  if (!e.sourceId) return null
  switch (e.sourceType) {
    case 'transaction':
      return `/transactions/${e.sourceId}`
    case 'receivable':
      return `/debts/${e.sourceId}`
    case 'payable':
      return `/suppliers/bills/${e.sourceId}`
    default:
      return null
  }
}

const severityRail = {
  critical: 'border-l-red-600',
  warning: 'border-l-amber-500',
  informational: 'border-l-sky-600',
}

export function RecommendationCard({ rec, defaultOpen = false }: { rec: RecommendationDto; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const update = useUpdateRecommendation()
  const canEdit = useAccess().can('manageFinancials')

  const setStatus = (status: RecommendationStatus, done: string) =>
    update.mutate(
      { id: rec.id, status },
      {
        onSuccess: () => toast.success(done),
        onError: (err) => toast.error('Could not update', { description: errorMessage(err) }),
      },
    )

  const bodyId = `rec-${rec.id}`
  return (
    <article className={cn('rounded-lg border border-l-4 border-line bg-surface shadow-card', severityRail[rec.severity], rec.status !== 'open' && 'opacity-80')}>
      <div className="p-4 sm:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={rec.severity} />
          {rec.status !== 'open' && <Badge variant="neutral">{rec.status === 'dismissed' ? 'Dismissed' : 'Resolved'}</Badge>}
          <span className="text-xs text-ink-muted">Rule {rec.ruleCode}</span>
        </div>
        <h3 className="mt-2 font-sans text-[17px] leading-snug font-semibold">{rec.title}</h3>
        <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{rec.explanation}</p>

        {rec.estimatedImpactCents !== null && (
          <p className="mt-3 inline-flex flex-wrap items-baseline gap-1.5 rounded-md bg-forest-50 px-3 py-1.5 text-sm">
            <span className="text-ink-soft">Estimated amount involved:</span>
            <Money cents={rec.estimatedImpactCents} className="font-semibold" />
          </p>
        )}

        {rec.relevantDates.length > 0 && (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {rec.relevantDates.map((d) => (
              <li key={d.label + d.date} className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft">
                <CalendarDays className="size-3.5 text-ink-muted" aria-hidden />
                {d.label}: <span className="font-semibold text-ink">{formatDate(d.date)}</span>
              </li>
            ))}
          </ul>
        )}

        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="mt-3 inline-flex cursor-pointer items-center gap-1 text-sm font-semibold text-forest-800 hover:underline"
        >
          <ChevronDown className={cn('size-4 transition-transform', open && 'rotate-180')} aria-hidden />
          {open ? 'Hide evidence and actions' : `Show evidence (${rec.evidence.length}) and actions (${rec.actions.length})`}
        </button>

        {open && (
          <div id={bodyId} className="mt-4 grid gap-5 md:grid-cols-2">
            <div>
              <h4 className="text-sm font-semibold">Evidence from your records</h4>
              {rec.evidence.length === 0 ? (
                <p className="mt-1 text-sm text-ink-muted">No individual records attached.</p>
              ) : (
                <ul className="mt-2 divide-y divide-line rounded-md border border-line">
                  {rec.evidence.map((ev, i) => {
                    const href = evidenceLink(ev)
                    const content = (
                      <>
                        <div className="min-w-0 flex-1">
                          <p className={cn('text-sm font-medium', href && 'text-forest-800 group-hover:underline')}>{ev.label}</p>
                          {(ev.detail || ev.date) && (
                            <p className="text-[13px] text-ink-muted">{[ev.date ? formatDate(ev.date) : null, ev.detail].filter(Boolean).join(' · ')}</p>
                          )}
                        </div>
                        {ev.amountCents !== null && <Money cents={ev.amountCents} className="text-sm font-semibold" />}
                      </>
                    )
                    return (
                      <li key={i}>
                        {href ? (
                          <Link to={href} className="group flex items-start gap-3 px-3 py-2.5 hover:bg-paper">
                            {content}
                          </Link>
                        ) : (
                          <div className="flex items-start gap-3 px-3 py-2.5">{content}</div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
            <div>
              <h4 className="text-sm font-semibold">Steps you could take</h4>
              <ol className="mt-2 space-y-2">
                {rec.actions.map((a, i) => (
                  <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-fg">{i + 1}</span>
                    {a}
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-[12px] leading-snug text-ink-muted">These are suggestions based on your records. They can help, but they cannot guarantee an outcome.</p>
            </div>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5 sm:px-5">
        {!canEdit ? null : rec.status === 'open' ? (
          <>
            <Button size="sm" variant="secondary" loading={update.isPending && update.variables?.status === 'resolved'} onClick={() => setStatus('resolved', 'Marked as resolved')}>
              <CheckCircle2 /> Mark resolved
            </Button>
            <Button size="sm" variant="ghost" loading={update.isPending && update.variables?.status === 'dismissed'} onClick={() => setStatus('dismissed', 'Recommendation dismissed')}>
              <EyeOff /> Dismiss
            </Button>
          </>
        ) : (
          <Button size="sm" variant="ghost" loading={update.isPending} onClick={() => setStatus('open', 'Recommendation reopened')}>
            <Undo2 /> Reopen
          </Button>
        )}
        <span className="ml-auto text-xs text-ink-muted">Updated {formatDateTime(rec.updatedAt)}</span>
      </div>
      {rec.resolutionNote && <p className="border-t border-line px-5 py-2 text-[13px] text-ink-muted">Note: {rec.resolutionNote}</p>}
    </article>
  )
}
