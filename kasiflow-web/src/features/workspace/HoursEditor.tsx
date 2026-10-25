import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { errorMessage } from '@/lib/apiClient'
import { hoursForDay, validateHours, WEEKDAY_NAMES } from '@/lib/barbershop'
import type { WorkingHoursDto } from '@/types/barbershop'
import { useSetHours } from '@/features/team/api'

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0] // Monday first

/** Weekly working hours as time blocks per weekday (up to three a day, e.g. split shifts around classes). */
export function HoursEditor({ staffId, hours, title = 'My working hours' }: { staffId: string; hours: WorkingHoursDto[]; title?: string }) {
  const initial = useMemo(() => hours.map((h) => ({ ...h })), [hours])
  const [draft, setDraft] = useState<WorkingHoursDto[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const save = useSetHours()
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)

  const update = (idx: number, patch: Partial<WorkingHoursDto>) => setDraft((d) => d.map((h, i) => (i === idx ? { ...h, ...patch } : h)))

  const submit = () => {
    const problem = validateHours(draft)
    setError(problem)
    if (problem) return
    save.mutate(
      { staffId, hours: draft },
      { onSuccess: () => toast.success('Working hours saved'), onError: (e) => toast.error('Could not save hours', { description: errorMessage(e) }) },
    )
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Customers can only book inside these hours. Add a second block for split days (for example around classes).</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y divide-line">
          {DAY_ORDER.map((day) => {
            const blocks = draft.map((h, i) => ({ h, i })).filter((x) => x.h.weekday === day)
            blocks.sort((a, b) => a.h.start.localeCompare(b.h.start))
            return (
              <li key={day} className="space-y-2 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {WEEKDAY_NAMES[day]}
                    {blocks.length === 0 && <span className="ml-2 font-normal text-ink-muted">Not working</span>}
                  </p>
                  {hoursForDay(draft, day).length < 3 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const last = hoursForDay(draft, day).at(-1)
                        setDraft((d) => [...d, last ? { weekday: day, start: last.end, end: last.end < '17:00' ? '18:00' : '20:00' } : { weekday: day, start: '08:00', end: '17:00' }])
                      }}
                    >
                      <Plus /> {blocks.length ? 'Add block' : 'Add hours'}
                    </Button>
                  )}
                </div>
                {blocks.map(({ h, i }, n) => (
                  <div key={i} className="flex min-w-0 items-center gap-2">
                    <Input
                      type="time"
                      aria-label={`${WEEKDAY_NAMES[day]} block ${n + 1} start`}
                      className="h-10 min-w-0 flex-1"
                      value={h.start}
                      onChange={(e) => update(i, { start: e.target.value })}
                    />
                    <span className="shrink-0 text-ink-muted">to</span>
                    <Input
                      type="time"
                      aria-label={`${WEEKDAY_NAMES[day]} block ${n + 1} end`}
                      className="h-10 min-w-0 flex-1"
                      value={h.end}
                      onChange={(e) => update(i, { end: e.target.value })}
                    />
                    <Button type="button" variant="ghost" size="icon-sm" className="shrink-0" aria-label={`Remove ${WEEKDAY_NAMES[day]} block ${n + 1}`} onClick={() => setDraft((d) => d.filter((_, j) => j !== i))}>
                      <Trash2 />
                    </Button>
                  </div>
                ))}
              </li>
            )
          })}
        </ul>
        {error && (
          <p role="alert" className="text-[13px] font-medium text-red-700">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button disabled={!dirty} loading={save.isPending} onClick={submit}>
            Save hours
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(initial)}>
              Undo changes
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
