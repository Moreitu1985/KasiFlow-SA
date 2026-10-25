import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Bookmark, BookmarkCheck, CalendarDays, ExternalLink, FileText, Globe } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { VerificationBadge } from '@/components/shared/Badges'
import { Callout } from '@/components/shared/Callout'
import { ErrorState } from '@/components/shared/States'
import { errorMessage } from '@/lib/apiClient'
import { formatDate } from '@/lib/format'
import { handleFormError } from '@/lib/forms'
import { APPLICATION_STATUS, OPPORTUNITY_TYPES, entries } from '@/lib/labels'
import { nullIfEmpty, optionalDate, optionalText } from '@/lib/validation'
import type { ApplicationStatus, OpportunityDto } from '@/types/api'
import { useOpportunity, useSaveOpportunity, useTrackOpportunity } from './api'

const statusKeys = Object.keys(APPLICATION_STATUS) as [ApplicationStatus, ...ApplicationStatus[]]
const trackSchema = z.object({ applicationStatus: z.enum(statusKeys), notes: optionalText(2000), personalDeadline: optionalDate })
type TrackValues = z.infer<typeof trackSchema>

function TrackingForm({ opp }: { opp: OpportunityDto }) {
  const track = useTrackOpportunity()
  const t = opp.tracking!
  const { register, handleSubmit, formState, reset, setError } = useForm<TrackValues>({ resolver: zodResolver(trackSchema) })
  useEffect(() => {
    reset({ applicationStatus: t.applicationStatus, notes: t.notes ?? '', personalDeadline: t.personalDeadline ?? '' })
  }, [t, reset])
  const submit = handleSubmit(async (v) => {
    try {
      await track.mutateAsync({ id: opp.id, input: { applicationStatus: v.applicationStatus, notes: nullIfEmpty(v.notes), personalDeadline: nullIfEmpty(v.personalDeadline) } })
      toast.success('Application tracking saved')
    } catch (err) {
      handleFormError(err, setError, { applicationStatus: 'applicationStatus', notes: 'notes', personalDeadline: 'personalDeadline' })
    }
  })
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4 rounded-lg border border-line bg-paper/60 p-4">
      <h3 className="font-sans text-sm font-semibold">Track your application</h3>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="t-status" label="Status">
          <NativeSelect {...register('applicationStatus')}>
            {entries(APPLICATION_STATUS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="t-deadline" label="My deadline" optional hint="Your own target date." error={formState.errors.personalDeadline?.message}>
          <Input type="date" {...register('personalDeadline')} />
        </Field>
      </div>
      <Field id="t-notes" label="Notes" optional error={formState.errors.notes?.message}>
        <Textarea rows={3} placeholder="Documents still needed, who you spoke to…" {...register('notes')} />
      </Field>
      <Button type="submit" variant="secondary" loading={formState.isSubmitting} className="self-start">
        Save tracking
      </Button>
    </form>
  )
}

export function OpportunityDrawer({ id, onOpenChange }: { id: string | null; onOpenChange: (open: boolean) => void }) {
  const q = useOpportunity(id)
  const save = useSaveOpportunity()
  const o = q.data

  const toggleSave = () => {
    if (!o) return
    const saving = !o.tracking
    save.mutate(
      { id: o.id, save: saving },
      {
        onSuccess: () => {
          toast.success(saving ? 'Saved to your list' : 'Removed from your list')
          void q.refetch()
        },
        onError: (err) => toast.error('Could not update', { description: errorMessage(err) }),
      },
    )
  }

  return (
    <Dialog open={!!id} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>{o?.title ?? 'Opportunity'}</DialogTitle>
          <DialogDescription>{o ? `${o.organisation} · ${OPPORTUNITY_TYPES[o.opportunityType]}` : 'Loading details'}</DialogDescription>
        </DialogHeader>
        <DialogBody className="flex flex-col gap-5">
          {q.isLoading ? (
            <Skeleton className="h-64" />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : o ? (
            <>
              <div className="flex flex-wrap gap-2">
                <VerificationBadge status={o.verificationStatus} large />
                {o.isPrivate && <Badge variant="outline">Added by you</Badge>}
              </div>
              {o.verificationStatus === 'sample' && (
                <Callout tone="warning" title="This is a sample, not a live opportunity">
                  It shows how opportunities look in KasiFlow. Do not apply or prepare documents for it.
                </Callout>
              )}
              {o.verificationStatus === 'requires_verification' && (
                <Callout tone="info" title="Check this with the organisation">
                  Confirm the details on the organisation’s official website or offices before you apply. Never pay a fee to “unlock” funding.
                </Callout>
              )}
              <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink-soft">{o.description}</p>
              <dl className="grid gap-4 sm:grid-cols-2">
                <div>
                  <dt className="flex items-center gap-1.5 text-[13px] text-ink-muted"><CalendarDays className="size-3.5" aria-hidden /> Deadline</dt>
                  <dd className="text-sm font-medium">{o.applicationDeadline ? formatDate(o.applicationDeadline) : 'Not specified'}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-[13px] text-ink-muted"><Globe className="size-3.5" aria-hidden /> Where</dt>
                  <dd className="text-sm font-medium">{o.geographicScope || '—'}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-ink-muted">Industry</dt>
                  <dd className="text-sm font-medium">{o.industry || 'Any'}</dd>
                </div>
                <div>
                  <dt className="text-[13px] text-ink-muted">Last checked</dt>
                  <dd className="text-sm font-medium">{o.lastCheckedOn ? formatDate(o.lastCheckedOn) : 'Not recorded'}</dd>
                </div>
              </dl>
              <section>
                <h3 className="font-sans text-sm font-semibold">Who can apply</h3>
                <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-ink-soft">{o.eligibilityCriteria || 'Not specified.'}</p>
              </section>
              <section>
                <h3 className="font-sans text-sm font-semibold">Documents usually needed</h3>
                {o.requiredDocuments.length ? (
                  <ul className="mt-2 space-y-1.5">
                    {o.requiredDocuments.map((d) => (
                      <li key={d} className="flex items-start gap-2 text-sm">
                        <FileText className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
                        {d}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-1 text-sm text-ink-muted">Not specified.</p>
                )}
              </section>
              <div className="flex flex-wrap gap-2">
                <Button variant={o.tracking ? 'secondary' : 'default'} onClick={toggleSave} loading={save.isPending}>
                  {o.tracking ? <BookmarkCheck /> : <Bookmark />}
                  {o.tracking ? 'Saved — remove' : 'Save to my list'}
                </Button>
                {o.sourceUrl && (
                  <Button asChild variant="outline">
                    <a href={o.sourceUrl} target="_blank" rel="noopener noreferrer">
                      <ExternalLink /> Open source website
                    </a>
                  </Button>
                )}
              </div>
              {o.tracking ? (
                <TrackingForm opp={o} />
              ) : (
                <p className="text-[13px] text-ink-muted">Save this opportunity to track your application status, notes and your own deadline.</p>
              )}
            </>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
