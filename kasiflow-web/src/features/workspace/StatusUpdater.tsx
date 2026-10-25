import { useState } from 'react'
import { toast } from 'sonner'
import { CircleCheck, Clock3, Coffee, Car, Ban, Moon, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { StaffStatusBadge } from '@/components/shared/StatusBadges'
import { errorMessage } from '@/lib/apiClient'
import { formatDateTime } from '@/lib/format'
import { formatTime, isTemporaryStatus, STAFF_STATUS_LABELS, STAFF_STATUSES, STATUS_DURATIONS } from '@/lib/barbershop'
import { cn } from '@/lib/utils'
import type { StaffProfileDto, StaffStatus } from '@/types/barbershop'
import { useSetStatus } from '@/features/team/api'

const ICONS: Record<StaffStatus, LucideIcon> = {
  available: CircleCheck,
  busy: Clock3,
  house_call: Car,
  on_break: Coffee,
  unavailable: Ban,
  off_duty: Moon,
}

const ACTIVE: Record<StaffStatus, string> = {
  available: 'border-emerald-600 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-600',
  busy: 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-500',
  house_call: 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-500',
  on_break: 'border-sky-600 bg-sky-50 text-sky-900 ring-2 ring-sky-600',
  unavailable: 'border-red-600 bg-red-50 text-red-900 ring-2 ring-red-600',
  off_duty: 'border-primary bg-forest-50 text-ink ring-2 ring-primary',
}

/** Big, thumb-friendly status buttons with an optional time limit, return-to status and short note. */
export function StatusUpdater({ profile }: { profile: StaffProfileDto }) {
  const current = profile.status
  const [picked, setPicked] = useState<StaffStatus>(current.status)
  const [forMinutes, setForMinutes] = useState<number | null>(null)
  const [revertTo, setRevertTo] = useState<StaffStatus>('available')
  const [note, setNote] = useState('')
  const set = useSetStatus()
  const changed = picked !== current.status || forMinutes !== null || note.trim() !== ''

  const save = () =>
    set.mutate(
      {
        staffId: profile.id,
        input: { status: picked, note: note.trim() || null, forMinutes: forMinutes ?? null, revertTo: forMinutes ? revertTo : null },
      },
      {
        onSuccess: (s) => {
          toast.success(`Status: ${s.label}`)
          setForMinutes(null)
          setNote('')
        },
        onError: (e) => toast.error('Could not update your status', { description: errorMessage(e) }),
      },
    )

  return (
    <Card className="min-w-0">
      <CardHeader className="gap-2">
        <CardTitle className="text-lg">My status</CardTitle>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <StaffStatusBadge status={current.status} label={current.label} className="px-2.5 py-1 text-[13px]" />
          {current.expiresAt && <span className="text-ink-muted">until {formatTime(current.expiresAt)}</span>}
          {current.note && <span className="text-ink-soft">“{current.note}”</span>}
        </div>
        <p className="text-[12px] text-ink-muted">Last updated {formatDateTime(current.updatedAt)}</p>
        {(current.stale || current.expired || current.explanation) && (
          <p role="status" className="rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
            {current.explanation ??
              (current.stale ? 'This status has not been updated for a while, so customers are not told you are free.' : 'Your temporary status has ended.')}
          </p>
        )}
        {current.blocksNewBookings && (
          <p className="rounded-md bg-sky-50 px-3 py-2 text-[13px] text-sky-900">New bookings are not offered for you while this status or your time off applies.</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-2" role="radiogroup" aria-label="Choose your status">
          {STAFF_STATUSES.map((s) => {
            const Icon = ICONS[s]
            const on = picked === s
            return (
              <button
                key={s}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setPicked(s)}
                className={cn(
                  'flex min-h-16 cursor-pointer items-center gap-2.5 rounded-lg border bg-surface px-3 py-3 text-left text-[15px] font-semibold transition-colors',
                  on ? ACTIVE[s] : 'border-line-strong text-ink hover:bg-forest-50',
                )}
              >
                <Icon className="size-6 shrink-0" aria-hidden />
                <span className="leading-tight">{STAFF_STATUS_LABELS[s]}</span>
              </button>
            )
          })}
        </div>

        {isTemporaryStatus(picked) && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">For how long?</legend>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                aria-pressed={forMinutes === null}
                onClick={() => setForMinutes(null)}
                className={cn('h-9 cursor-pointer rounded-md border px-3 text-[13px] font-semibold', forMinutes === null ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong bg-surface')}
              >
                Until I change it
              </button>
              {STATUS_DURATIONS.map((d) => (
                <button
                  key={d.minutes}
                  type="button"
                  aria-pressed={forMinutes === d.minutes}
                  onClick={() => setForMinutes(d.minutes)}
                  className={cn('h-9 cursor-pointer rounded-md border px-3 text-[13px] font-semibold', forMinutes === d.minutes ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong bg-surface')}
                >
                  {d.label}
                </button>
              ))}
            </div>
            {forMinutes !== null && (
              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                <Label htmlFor="revert-to" className="shrink-0">
                  Then go back to
                </Label>
                <NativeSelect id="revert-to" className="sm:w-56" value={revertTo} onChange={(e) => setRevertTo(e.target.value as StaffStatus)}>
                  {STAFF_STATUSES.filter((s) => s !== picked).map((s) => (
                    <option key={s} value={s}>
                      {STAFF_STATUS_LABELS[s]}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            )}
          </fieldset>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="status-note">
            Short note <span className="font-normal text-ink-muted">(optional, team only)</span>
          </Label>
          <Input id="status-note" maxLength={120} placeholder="e.g. Back after lunch" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <Button size="lg" className="w-full sm:w-auto" disabled={!changed} loading={set.isPending} onClick={save}>
          Update my status
        </Button>
      </CardContent>
    </Card>
  )
}
