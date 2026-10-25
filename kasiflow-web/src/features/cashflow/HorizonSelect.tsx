import { cn } from '@/lib/utils'

export const HORIZONS = [14, 30, 60, 90]

export function HorizonSelect({ value, onChange }: { value: number | undefined; onChange: (d: number) => void }) {
  return (
    <div role="group" aria-label="Forecast horizon" className="flex rounded-md border border-line-strong bg-surface p-0.5">
      {HORIZONS.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={value === d}
          onClick={() => onChange(d)}
          className={cn(
            'cursor-pointer rounded px-3 py-1.5 text-[13px] font-semibold transition-colors',
            value === d ? 'bg-primary text-primary-fg' : 'text-ink-soft hover:bg-forest-50',
          )}
        >
          {d} days
        </button>
      ))}
    </div>
  )
}
