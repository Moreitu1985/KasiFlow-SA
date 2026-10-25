import { toast } from 'sonner'
import { ExternalLink } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Callout } from '@/components/shared/Callout'
import { ErrorState, ListSkeleton } from '@/components/shared/States'
import { errorMessage } from '@/lib/apiClient'
import { formatDate } from '@/lib/format'
import { REGISTRATION_STATUS, entries } from '@/lib/labels'
import type { RegistrationStatus } from '@/types/api'
import { useRegistration, useUpdateRegistrationItem, useUpdateRegistrationStatus } from './api'
import { ChecklistItem } from './ChecklistItem'

export function RegistrationTab() {
  const q = useRegistration()
  const updateItem = useUpdateRegistrationItem()
  const updateStatus = useUpdateRegistrationStatus()
  if (q.isLoading) return <ListSkeleton rows={4} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const r = q.data
  if (!r) return null

  return (
    <div className="space-y-5">
      <Callout tone="info" title="General information, not advice">
        {r.disclaimer}
      </Callout>
      <div className="grid gap-4 rounded-lg border border-line bg-surface p-5 sm:grid-cols-[1fr_auto] sm:items-end">
        <div>
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">
              {r.completedCount} of {r.totalCount} steps done
            </p>
            <p className="font-display text-2xl font-bold tabular">{Math.round(r.progressPercent)}%</p>
          </div>
          <Progress value={r.progressPercent} label="Registration progress" />
        </div>
        <div className="sm:w-56">
          <Label htmlFor="reg-status">Registration status</Label>
          <NativeSelect
            id="reg-status"
            className="mt-1.5"
            value={r.registrationStatus}
            disabled={updateStatus.isPending}
            onChange={(e) =>
              updateStatus.mutate(e.target.value as RegistrationStatus, {
                onSuccess: () => toast.success('Status updated'),
                onError: (err) => toast.error('Could not update', { description: errorMessage(err) }),
              })
            }
          >
            {entries(REGISTRATION_STATUS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      <div className="space-y-3">
        {r.steps.map((s, i) => (
          <ChecklistItem
            key={s.key}
            id={`reg-${s.key}`}
            index={i + 1}
            title={s.title}
            completed={s.completed}
            notes={s.notes}
            badges={s.appliesTo ? <Badge variant="outline">{s.appliesTo}</Badge> : undefined}
            onSave={(completed, notes) => updateItem.mutateAsync({ key: s.key, completed, notes })}
          >
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{s.description}</p>
            {s.resources.length > 0 && (
              <ul className="mt-3 space-y-2">
                {s.resources.map((res) => (
                  <li key={res.url} className="text-sm">
                    <a href={res.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold text-forest-800 hover:underline">
                      <ExternalLink className="size-3.5" aria-hidden /> {res.title}
                    </a>
                    <span className="block text-[13px] text-ink-muted">{res.purpose}</span>
                    {res.lastChecked && <span className="block text-[12px] text-ink-muted">Link checked {formatDate(res.lastChecked)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </ChecklistItem>
        ))}
      </div>

      <p className="text-[13px] text-ink-muted">
        Official links were opened and confirmed on the date shown. Government websites change; if a link no longer works, search the authority’s own website.
      </p>
    </div>
  )
}
