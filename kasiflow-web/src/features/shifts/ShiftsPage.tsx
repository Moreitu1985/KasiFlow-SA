import { useState } from 'react'
import { ClipboardCheck, History } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { NativeSelect, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Money } from '@/components/shared/Money'
import { RoleHeader } from '@/features/access/RoleHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDateTime } from '@/lib/format'
import { varianceWording } from '@/lib/automation'
import { useAccess } from '@/features/access/useAccess'
import type { ShiftDto } from '@/types/automation'
import { useReviewShift, useShifts } from './api'
import { BreakdownList, MyShiftCard, VarianceResult } from './MyShiftCard'

const FILTERS = [
  { value: 'needs_review', label: 'Needs review' },
  { value: 'open', label: 'Open' },
  { value: 'closed', label: 'Closed' },
  { value: 'reviewed', label: 'Reviewed' },
  { value: '', label: 'All' },
]

function StatusBadge({ s }: { s: ShiftDto }) {
  if (s.status === 'open') return <Badge variant="info">Open</Badge>
  if (s.status === 'reviewed') return <Badge variant="success">Reviewed</Badge>
  if (s.needsReview) return <Badge variant="warning">Needs review</Badge>
  return <Badge variant="neutral">Closed</Badge>
}

function ReviewDialog({ shift, onOpenChange }: { shift: ShiftDto | null; onOpenChange: (o: boolean) => void }) {
  const review = useReviewShift()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  const close = (o: boolean) => {
    if (!o) {
      setNote('')
      setError(undefined)
    }
    onOpenChange(o)
  }
  return (
    <Dialog open={!!shift} onOpenChange={close}>
      <DialogContent variant="sheet">
        {shift && (
          <form
            className="flex min-h-0 flex-1 flex-col"
            onSubmit={(e) => {
              e.preventDefault()
              if (shift.needsReview && note.trim().length === 0) {
                setError("Write what you found, for example 'counting error, recounted'.")
                return
              }
              review.mutate(
                { id: shift.id, note: note.trim() || null },
                {
                  onSuccess: () => {
                    toast.success('Cash-up reviewed')
                    close(false)
                  },
                  onError: (err) => {
                    if (err instanceof ApiError && err.fieldError('note')) setError(err.fieldError('note'))
                    else toast.error('Could not review', { description: errorMessage(err) })
                  },
                },
              )
            }}
          >
            <DialogHeader>
              <DialogTitle>Review cash-up</DialogTitle>
              <DialogDescription>
                {shift.staffName} · {shift.branchName} · {formatDateTime(shift.openedAt)} to {formatDateTime(shift.closedAt)}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="space-y-4">
              <VarianceResult s={shift} />
              <BreakdownList s={shift} />
              {shift.closeNote && (
                <p className="text-sm">
                  <span className="font-semibold">Their note:</span> {shift.closeNote}
                </p>
              )}
              <Field
                id="rv-note"
                label="Review note"
                optional={!shift.needsReview}
                error={error}
                hint="Talk to the person first. Differences are usually counting slips or records that were missed."
              >
                <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
              </Field>
            </DialogBody>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" loading={review.isPending}>
                <ClipboardCheck /> Mark as reviewed
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function ReviewerList() {
  const [status, setStatus] = useState('needs_review')
  const q = useShifts(status)
  const [reviewing, setReviewing] = useState<ShiftDto | null>(null)
  return (
    <Card className="min-w-0">
      <CardHeader className="gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <CardTitle>Shifts and cash-ups</CardTitle>
          <CardDescription>Close-outs with a difference above your threshold need a review note.</CardDescription>
        </div>
        <div className="sm:w-48">
          <Label htmlFor="shift-filter">Show</Label>
          <NativeSelect id="shift-filter" className="mt-1.5" value={status} onChange={(e) => setStatus(e.target.value)}>
            {FILTERS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </NativeSelect>
        </div>
      </CardHeader>
      <CardContent>
        {q.isLoading ? (
          <ListSkeleton rows={3} />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data?.length ? (
          <EmptyState icon={History} title="No shifts here" />
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {q.data.map((s) => {
              const w = s.status === 'open' ? null : varianceWording(s.varianceCents)
              return (
                <li key={s.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {s.staffName} <StatusBadge s={s} />
                    </p>
                    <p className="text-[13px] text-ink-muted">
                      {s.branchName} · opened {formatDateTime(s.openedAt)}
                      {s.closedAt && ` · closed ${formatDateTime(s.closedAt)}`}
                    </p>
                    {w && <p className={`text-[13px] font-medium ${w.tone === 'ok' ? 'text-ink-soft' : 'text-amber-800'}`}>{w.title}</p>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[13px] text-ink-muted">
                      {s.status === 'open' ? 'Expected now' : 'Counted'}{' '}
                      <Money cents={s.status === 'open' ? s.breakdown.expectedNowCents : s.countedCashCents} className="font-semibold text-ink" />
                    </span>
                    {s.status === 'closed' && (
                      <Button size="sm" variant={s.needsReview ? 'default' : 'outline'} onClick={() => setReviewing(s)}>
                        Review
                      </Button>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
      <ReviewDialog shift={reviewing} onOpenChange={(o) => !o && setReviewing(null)} />
    </Card>
  )
}

export function ShiftsPage() {
  const { can } = useAccess()
  return (
    <div className="space-y-6">
      <RoleHeader
        title="Shifts & cash-up"
        description="Open a shift with your float, record cash drops, and count the till when you close. Only cash counts in the till; card and QR sales are shown separately."
       
      />
      {can('operateShift') && <MyShiftCard />}
      {can('reviewShifts') && <ReviewerList />}
    </div>
  )
}
