import { CalendarX2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { addDays, todayJhb } from '@/lib/format'
import { formatDayLabel, slotsByPeriod, type SlotGroup } from '@/lib/barbershop'
import { errorMessage } from '@/lib/apiClient'
import { cn } from '@/lib/utils'

/** Horizontal strip of the next days plus a date input for anything further out. */
export function DateStrip({ value, onChange, days = 7, maxDays = 60, id = 'slot-date' }: { value: string; onChange: (d: string) => void; days?: number; maxDays?: number; id?: string }) {
  const today = todayJhb()
  const list = Array.from({ length: days }, (_, i) => addDays(today, i))
  return (
    <div className="min-w-0 space-y-2">
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1" role="group" aria-label="Choose a day">
        {list.map((d, i) => {
          const active = d === value
          const [wd, ...rest] = formatDayLabel(d).split(' ')
          return (
            <button
              key={d}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(d)}
              className={cn(
                'flex min-w-14 shrink-0 cursor-pointer flex-col items-center rounded-md border px-2 py-1.5 text-[12px] leading-tight font-semibold transition-colors',
                active ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong bg-surface text-ink-soft hover:bg-forest-50',
              )}
            >
              <span>{i === 0 ? 'Today' : wd}</span>
              <span className="text-[13px]">{rest.join(' ')}</span>
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2">
        <Label htmlFor={id} className="shrink-0 text-[13px] text-ink-muted">
          Or pick a date
        </Label>
        <Input id={id} type="date" className="h-9 w-auto" value={value} min={today} max={addDays(today, maxDays)} onChange={(e) => e.target.value && onChange(e.target.value)} />
      </div>
    </div>
  )
}

/**
 * Free times for one day, grouped Morning / Afternoon / Evening. `value` is the chosen slot's startsAt; when a time
 * has several free barbers and none was chosen, `staffChoice` lets the caller know which barber the slot belongs to.
 */
export function SlotPicker({
  groups,
  loading,
  error,
  notes,
  value,
  onChange,
  showStaff,
}: {
  groups: SlotGroup[]
  loading?: boolean
  error?: unknown
  notes?: string[]
  value: string | null
  onChange: (slot: SlotGroup) => void
  showStaff?: boolean
}) {
  if (loading)
    return (
      <div className="grid grid-cols-4 gap-2" aria-busy aria-label="Loading free times">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-10" />
        ))}
      </div>
    )
  if (error) return <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage(error)}</p>
  return (
    <div className="space-y-3">
      {groups.length === 0 ? (
        <div className="flex items-start gap-2.5 rounded-md border border-dashed border-line-strong bg-surface px-3 py-3 text-sm text-ink-soft">
          <CalendarX2 className="mt-0.5 size-4 shrink-0 text-ink-muted" aria-hidden />
          <span>No free times on this day for what you chose. Try another day{showStaff ? ' or another barber' : ''}.</span>
        </div>
      ) : (
        slotsByPeriod(groups).map(({ period, slots }) => (
          <fieldset key={period}>
            <legend className="mb-1.5 text-[13px] font-semibold text-ink-muted">{period}</legend>
            <div className="grid grid-cols-3 gap-2 min-[420px]:grid-cols-4 sm:grid-cols-5">
              {slots.map((s) => {
                const active = s.startsAt === value
                return (
                  <button
                    key={s.startsAt}
                    type="button"
                    aria-pressed={active}
                    onClick={() => onChange(s)}
                    title={showStaff ? s.staff.map((x) => x.staffName).join(', ') : undefined}
                    className={cn(
                      'flex min-h-10 cursor-pointer flex-col items-center justify-center rounded-md border px-1 py-1.5 text-sm font-semibold tabular transition-colors',
                      active ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong bg-surface text-ink hover:border-forest-700 hover:bg-forest-50',
                    )}
                  >
                    {s.time}
                    {showStaff && <span className={cn('text-[11px] font-medium', active ? 'text-white/80' : 'text-ink-muted')}>{s.staff.length === 1 ? s.staff[0].staffName.split(' ')[0] : `${s.staff.length} free`}</span>}
                  </button>
                )
              })}
            </div>
          </fieldset>
        ))
      )}
      {notes && notes.length > 0 && (
        <ul className="space-y-1 text-[13px] text-ink-muted">
          {notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
