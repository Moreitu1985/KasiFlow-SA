import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { BookOpenCheck, Eye, LifeBuoy, RotateCcw, ShieldAlert, ShieldCheck, ThumbsDown } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { isSafetyAlert, safetyAlertLink } from '@/lib/customer'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { NativeSelect, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Callout } from '@/components/shared/Callout'
import { KpiCard } from '@/components/shared/KpiCard'
import { Money } from '@/components/shared/Money'
import { RoleHeader } from '@/features/access/RoleHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { SeverityBadge } from '@/components/shared/Badges'
import { AlertStatusBadge } from '@/components/shared/StatusBadges'
import { errorMessage } from '@/lib/apiClient'
import { formatDate, formatDateTime } from '@/lib/format'
import { evidenceLink } from '@/lib/barbershop'
import { useAccess } from '@/features/access/useAccess'
import type { AlertDto, AlertStatus } from '@/types/barbershop'
import { useAlerts, useSetAlertStatus } from './api'

type Filter = '' | 'all' | 'resolved' | 'false_positive'

function NoteDialog({ target, onOpenChange }: { target: { alert: AlertDto; status: AlertStatus } | null; onOpenChange: (o: boolean) => void }) {
  const set = useSetAlertStatus()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  const label = target?.status === 'false_positive' ? 'Mark as false positive' : 'Resolve alert'
  return (
    <Dialog
      open={!!target}
      onOpenChange={(o) => {
        if (!o) {
          setNote('')
          setError(undefined)
        }
        onOpenChange(o)
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{target?.alert.title}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field id="al-note" label="What did you check and find?" hint="Stick to facts. This note is kept with the alert." error={error}>
            <Textarea rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={set.isPending}
            onClick={() => {
              if (!target) return
              if (note.trim().length < 3) return setError('Write what you checked and found.')
              set.mutate(
                { id: target.alert.id, status: target.status, note: note.trim() },
                {
                  onSuccess: () => {
                    toast.success(target.status === 'false_positive' ? 'Marked as false positive' : 'Alert resolved')
                    setNote('')
                    onOpenChange(false)
                  },
                  onError: (e) => setError(errorMessage(e)),
                },
              )
            }}
          >
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AlertCard({ a, canManage, onNote }: { a: AlertDto; canManage: boolean; onNote: (s: AlertStatus) => void }) {
  const set = useSetAlertStatus()
  const quick = (status: AlertStatus, ok: string) =>
    set.mutate({ id: a.id, status }, { onSuccess: () => toast.success(ok), onError: (e) => toast.error('Could not update', { description: errorMessage(e) }) })
  const closed = a.status === 'resolved' || a.status === 'false_positive'
  // House-call safety alerts (help requested / check-in late) are about a person's safety, not fraud.
  const safety = isSafetyAlert(a.ruleCode)
  const bookingLink = safetyAlertLink(a.ruleCode, a.affectedType, a.affectedId)
  return (
    <Card className={`min-w-0 ${a.severity === 'critical' && !closed ? 'border-l-4 border-l-red-600' : a.severity === 'warning' && !closed ? 'border-l-4 border-l-amber-500' : ''}`}>
      <CardContent className="space-y-3 pt-5">
        <div className="flex flex-wrap items-center gap-2">
          {safety && (
            <Badge variant="critical" className="bg-red-700 text-white border-red-700">
              <LifeBuoy aria-hidden /> Barber safety
            </Badge>
          )}
          <SeverityBadge severity={a.severity} />
          <AlertStatusBadge status={a.status} />
          <span className="text-[12px] text-ink-muted">Last seen {formatDateTime(a.lastDetectedAt)}</span>
        </div>
        <h2 className="font-sans text-base font-semibold [overflow-wrap:anywhere]">{a.title}</h2>
        <p className="text-sm leading-relaxed text-ink-soft">{a.reason}</p>
        {a.evidence.length > 0 && (
          <div>
            <p className="text-[13px] font-semibold">Evidence</p>
            <ul className="mt-1 divide-y divide-line rounded-md border border-line">
              {a.evidence.map((e, i) => {
                const to = evidenceLink(e.sourceType, e.sourceId)
                return (
                  <li key={i} className="flex flex-col gap-1 px-3 py-2 text-sm sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      {to ? (
                        <Link to={to} className="font-medium text-forest-800 hover:underline [overflow-wrap:anywhere]">
                          {e.label}
                        </Link>
                      ) : (
                        <span className="font-medium [overflow-wrap:anywhere]">{e.label}</span>
                      )}
                      {e.detail && <span className="block text-[12px] text-ink-muted">{e.detail}</span>}
                    </div>
                    <div className="shrink-0 text-[13px] sm:text-right">
                      {e.amountCents != null && <Money cents={e.amountCents} tone="auto" className="font-semibold" />}
                      {e.date && <span className="block text-[12px] text-ink-muted">{formatDate(e.date)}</span>}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
        <div className="rounded-md bg-forest-50 px-3 py-2 text-sm text-ink">
          <span className="font-semibold">What to do: </span>
          {a.recommendedAction}
        </div>
        {bookingLink && (
          <Button asChild size="sm" variant={closed ? 'outline' : 'default'}>
            <Link to={bookingLink}>
              <LifeBuoy /> Open the visit and its check-ins
            </Link>
          </Button>
        )}
        {a.reviewNote && (
          <p className="text-[13px] text-ink-soft">
            <span className="font-semibold">Review note: </span>
            {a.reviewNote} {a.reviewedAt && <span className="text-ink-muted">({formatDateTime(a.reviewedAt)})</span>}
          </p>
        )}
        {canManage && (
          <div className="flex flex-wrap gap-2 pt-1">
            {safety && !closed && <p className="w-full text-[12px] text-ink-muted">Resolve this once you have spoken to the barber and know they are safe.</p>}
            {a.status === 'open' && (
              <Button size="sm" variant="outline" loading={set.isPending} onClick={() => quick('under_review', 'Marked as under review')}>
                <Eye /> Under review
              </Button>
            )}
            {!closed && (
              <>
                <Button size="sm" onClick={() => onNote('resolved')}>
                  <ShieldCheck /> Resolve
                </Button>
                <Button size="sm" variant="ghost" onClick={() => onNote('false_positive')}>
                  <ThumbsDown /> False positive
                </Button>
              </>
            )}
            {closed && (
              <Button size="sm" variant="outline" loading={set.isPending} onClick={() => quick('open', 'Alert reopened')}>
                <RotateCcw /> Reopen
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function AlertsPage() {
  const { can } = useAccess()
  const [status, setStatus] = useState<Filter>('')
  const [severity, setSeverity] = useState('')
  const q = useAlerts(status, severity)
  const [noteFor, setNoteFor] = useState<{ alert: AlertDto; status: AlertStatus } | null>(null)
  const s = q.data

  return (
    <div className="space-y-5">
      <RoleHeader
        title="Fraud & Alerts"
        description="Warnings worked out from your own records: payments that do not match, bank-detail changes, cash-up differences and more — plus barber safety alerts from house calls."
       
        actions={
          can('viewFraud') && (
            <Button asChild variant="outline">
              <Link to="/fraud">
                <BookOpenCheck /> Scam guide & incident log
              </Link>
            </Button>
          )
        }
      />
      {s && (
        <Callout tone="info" title="Warnings, not accusations">
          {s.disclaimer}
        </Callout>
      )}
      {s && (
        <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
          <KpiCard label="Open" value={s.open} definition="Alerts nobody has looked at yet." tone={s.open > 0 ? 'warning' : 'default'} />
          <KpiCard label="Under review" value={s.underReview} definition="Someone is checking these." />
          <KpiCard label="Critical" value={s.critical} definition="Open or under review, critical severity." tone={s.critical > 0 ? 'critical' : 'default'} />
          <KpiCard label="Warnings" value={s.warning} definition="Open or under review, warning severity." />
        </div>
      )}
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 sm:max-w-lg">
        <div>
          <Label htmlFor="al-status">Show</Label>
          <NativeSelect id="al-status" className="mt-1.5" value={status} onChange={(e) => setStatus(e.target.value as Filter)}>
            <option value="">Open and under review</option>
            <option value="all">All alerts</option>
            <option value="resolved">Resolved</option>
            <option value="false_positive">False positives</option>
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="al-sev">Severity</Label>
          <NativeSelect id="al-sev" className="mt-1.5" value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="">All severities</option>
            <option value="critical">Critical</option>
            <option value="warning">Warning</option>
            <option value="informational">Info</option>
          </NativeSelect>
        </div>
      </div>
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !s?.items.length ? (
        <EmptyState icon={ShieldAlert} title="No alerts here" description="Nothing matches this filter. Alerts are re-checked when your records are refreshed." />
      ) : (
        <ul className="space-y-4">
          {s.items.map((a) => (
            <li key={a.id}>
              <AlertCard a={a} canManage={can('manageAlerts')} onNote={(st) => setNoteFor({ alert: a, status: st })} />
            </li>
          ))}
        </ul>
      )}
      <NoteDialog target={noteFor} onOpenChange={(o) => !o && setNoteFor(null)} />
    </div>
  )
}
