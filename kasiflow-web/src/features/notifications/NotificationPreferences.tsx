import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import type { NotificationPreferencesDto } from '@/types/automation'
import { useNotificationPreferences, useUpdatePreferences } from './api'

const KINDS: { key: 'criticalCash' | 'cashup' | 'lowStock' | 'integrations'; label: string; hint: string }[] = [
  { key: 'criticalCash', label: 'Cash warnings', hint: 'Possible shortages and balances below your buffer.' },
  { key: 'cashup', label: 'Cash-up differences', hint: 'Closed shifts that need a review.' },
  { key: 'lowStock', label: 'Low stock', hint: 'Products at or below their minimum.' },
  { key: 'integrations', label: 'Integrations', hint: 'Connection problems, reversed payments and payments to review.' },
]

function Form({ initial }: { initial: NotificationPreferencesDto }) {
  const save = useUpdatePreferences()
  const [v, setV] = useState(initial)
  const [error, setError] = useState<string>()
  return (
    <form
      noValidate
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault()
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(v.briefingTime)) {
          setError('Use a time like 07:00.')
          return
        }
        setError(undefined)
        save.mutate(
          { ...v, email: false },
          {
            onSuccess: () => toast.success('Notification preferences saved'),
            onError: (err) => (err instanceof ApiError && err.fieldError('briefingTime') ? setError(err.fieldError('briefingTime')) : toast.error('Could not save', { description: errorMessage(err) })),
          },
        )
      }}
    >
      <Field id="np-time" label="Daily briefing time" error={error} hint="South African time. The briefing is prepared each morning.">
        <Input type="time" className="sm:w-40" value={v.briefingTime} onChange={(e) => setV({ ...v, briefingTime: e.target.value })} />
      </Field>
      <div className="flex items-center justify-between gap-4 rounded-md border border-line p-3">
        <div>
          <Label htmlFor="np-inapp">In-app notifications</Label>
          <p className="text-[13px] text-ink-muted">The bell at the top of the screen.</p>
        </div>
        <Switch id="np-inapp" checked={v.inApp} onCheckedChange={(c) => setV({ ...v, inApp: c })} />
      </div>
      <fieldset className="space-y-2" disabled={!v.inApp}>
        <legend className="text-sm font-medium">Tell me about</legend>
        {KINDS.map((k) => (
          <div key={k.key} className="flex items-center justify-between gap-4 rounded-md border border-line p-3">
            <div>
              <Label htmlFor={`np-${k.key}`}>{k.label}</Label>
              <p className="text-[13px] text-ink-muted">{k.hint}</p>
            </div>
            <Switch id={`np-${k.key}`} checked={v[k.key]} disabled={!v.inApp} onCheckedChange={(c) => setV({ ...v, [k.key]: c })} />
          </div>
        ))}
      </fieldset>
      <div className="flex items-center justify-between gap-4 rounded-md border border-dashed border-line-strong p-3 opacity-80">
        <div>
          <Label htmlFor="np-email">Email</Label>
          <p className="text-[13px] text-ink-muted">No email service configured. KasiFlow never sends messages through an unconfigured service.</p>
        </div>
        <Switch id="np-email" checked={false} disabled aria-describedby="np-email-note" />
        <span id="np-email-note" className="sr-only">
          Email notifications are unavailable.
        </span>
      </div>
      <Button type="submit" variant="secondary" loading={save.isPending}>
        Save notification preferences
      </Button>
    </form>
  )
}

export function NotificationPreferences() {
  const q = useNotificationPreferences()
  if (q.isLoading) return <Skeleton className="h-64" />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data) return null
  return <Form key={JSON.stringify(q.data)} initial={q.data} />
}
