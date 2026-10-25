import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RANGE_PRESETS } from '@/lib/periods'
import { cn } from '@/lib/utils'

export function DateRangeBar({ from, to, onChange, className }: { from: string; to: string; onChange: (r: { from: string; to: string }) => void; className?: string }) {
  const invalid = from > to
  return (
    <div className={cn('flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 lg:flex-row lg:items-end', className)}>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick date ranges">
        {RANGE_PRESETS.map((p) => {
          const r = p.range()
          const active = r.from === from && r.to === to
          return (
            <button
              key={p.key}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(r)}
              className={cn(
                'cursor-pointer rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors',
                active ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong bg-surface text-ink-soft hover:bg-forest-50',
              )}
            >
              {p.label}
            </button>
          )
        })}
      </div>
      <div className="grid grid-cols-2 gap-2 lg:ml-auto lg:w-80">
        <div>
          <Label htmlFor="range-from">From</Label>
          <Input id="range-from" type="date" className="mt-1.5" value={from} max={to} onChange={(e) => onChange({ from: e.target.value, to })} aria-invalid={invalid || undefined} />
        </div>
        <div>
          <Label htmlFor="range-to">To</Label>
          <Input id="range-to" type="date" className="mt-1.5" value={to} min={from} onChange={(e) => onChange({ from, to: e.target.value })} aria-invalid={invalid || undefined} />
        </div>
      </div>
      {invalid && (
        <p role="alert" className="text-[13px] font-medium text-red-700">
          The start date must be before the end date.
        </p>
      )}
    </div>
  )
}
