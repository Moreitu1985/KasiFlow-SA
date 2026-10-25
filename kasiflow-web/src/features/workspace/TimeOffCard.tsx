import { useState } from 'react'
import { toast } from 'sonner'
import { CalendarOff, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { todayJhb } from '@/lib/format'
import { formatWhen, jhbIso, TIME_OFF_KINDS } from '@/lib/barbershop'
import { entries } from '@/lib/labels'
import type { TimeOffDto, TimeOffKind } from '@/types/barbershop'
import { useAddTimeOff, useDeleteTimeOff } from '@/features/team/api'

/** Blocks for classes, exams, leave or personal time. Bookings are not offered inside them. */
export function TimeOffCard({ staffId, items }: { staffId: string; items: TimeOffDto[] }) {
  const add = useAddTimeOff()
  const del = useDeleteTimeOff()
  const today = todayJhb()
  const [kind, setKind] = useState<TimeOffKind>('class')
  const [startDate, setStartDate] = useState(today)
  const [startTime, setStartTime] = useState('08:00')
  const [endDate, setEndDate] = useState(today)
  const [endTime, setEndTime] = useState('12:00')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const startsAt = jhbIso(startDate, startTime)
    const endsAt = jhbIso(endDate, endTime)
    if (new Date(endsAt) <= new Date(startsAt)) {
      setErrors({ endsAt: 'The end must be after the start.' })
      return
    }
    setErrors({})
    add.mutate(
      { staffId, input: { kind, startsAt, endsAt, note: note.trim() || null } },
      {
        onSuccess: () => {
          toast.success('Time off added')
          setNote('')
        },
        onError: (err) => {
          if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])))
          else toast.error('Could not add time off', { description: errorMessage(err) })
        },
      },
    )
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Time off</CardTitle>
        <CardDescription>Classes, exams, leave or personal time. Customers are not offered these times.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {items.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-ink-muted">
            <CalendarOff className="size-4" aria-hidden /> No time off coming up.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line">
            {items.map((t) => (
              <li key={t.id} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">
                    <Badge variant="info" className="mr-1.5">
                      {TIME_OFF_KINDS[t.kind] ?? t.kind}
                    </Badge>
                    {formatWhen(t.startsAt)} → {formatWhen(t.endsAt)}
                  </p>
                  {t.note && <p className="text-[13px] text-ink-muted">{t.note}</p>}
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Remove this time off"
                  loading={del.isPending && del.variables?.id === t.id}
                  onClick={() =>
                    del.mutate({ staffId, id: t.id }, { onSuccess: () => toast.success('Time off removed'), onError: (e) => toast.error('Could not remove', { description: errorMessage(e) }) })
                  }
                >
                  <Trash2 />
                </Button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={submit} noValidate className="space-y-3 rounded-md border border-line bg-paper/60 p-3">
          <p className="text-sm font-semibold">Add time off</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="to-kind" label="What for" error={errors.kind}>
              <NativeSelect value={kind} onChange={(e) => setKind(e.target.value as TimeOffKind)}>
                {entries(TIME_OFF_KINDS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="to-note" label="Note" optional error={errors.note}>
              <Input maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Accounting test" />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Field id="to-sd" label="From (date)">
              <Input type="date" min={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </Field>
            <Field id="to-st" label="Time">
              <Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
            </Field>
            <Field id="to-ed" label="To (date)" error={errors.endsAt}>
              <Input type="date" min={startDate} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </Field>
            <Field id="to-et" label="Time">
              <Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} />
            </Field>
          </div>
          <Button type="submit" variant="secondary" loading={add.isPending}>
            Add time off
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}
