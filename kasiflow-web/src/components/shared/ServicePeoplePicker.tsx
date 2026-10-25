import { Check, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatZAR } from '@/lib/format'
import { durationLabel } from '@/lib/barbershop'
import { cn } from '@/lib/utils'

export interface PickerService {
  id: string
  name: string
  description?: string | null
  priceCents: number
  durationMinutes: number
  allowsHouseCall: boolean
}

export interface PersonChoice {
  label: string
  serviceIds: string[]
}

/**
 * Choose services for one or more people (e.g. a dad and two boys). Each person gets their own list; a service can
 * be picked once per person. Services that are not offered as a house call are disabled for house calls.
 */
export function ServicePeoplePicker({
  services,
  people,
  onChange,
  houseCall,
  maxPeople = 6,
}: {
  services: PickerService[]
  people: PersonChoice[]
  onChange: (p: PersonChoice[]) => void
  houseCall?: boolean
  maxPeople?: number
}) {
  const multi = people.length > 1
  const toggle = (pi: number, id: string) =>
    onChange(people.map((p, i) => (i === pi ? { ...p, serviceIds: p.serviceIds.includes(id) ? p.serviceIds.filter((x) => x !== id) : [...p.serviceIds, id] } : p)))

  return (
    <div className="space-y-4">
      {people.map((p, pi) => (
        <fieldset key={pi} className={cn('min-w-0 space-y-2', multi && 'rounded-lg border border-line p-3')}>
          {multi ? (
            <div className="flex items-center gap-2">
              <legend className="sr-only">Services for {p.label || `person ${pi + 1}`}</legend>
              <Input
                aria-label={`Name or label for person ${pi + 1}`}
                className="h-9 max-w-56"
                maxLength={40}
                value={p.label}
                placeholder={`Person ${pi + 1}`}
                onChange={(e) => onChange(people.map((x, i) => (i === pi ? { ...x, label: e.target.value } : x)))}
              />
              <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${p.label || `person ${pi + 1}`}`} onClick={() => onChange(people.filter((_, i) => i !== pi))}>
                <X />
              </Button>
            </div>
          ) : (
            <legend className="text-sm font-medium">Choose services</legend>
          )}
          <div className="grid gap-2 sm:grid-cols-2">
            {services.map((s) => {
              const on = p.serviceIds.includes(s.id)
              const blocked = !!houseCall && !s.allowsHouseCall
              return (
                <button
                  key={s.id}
                  type="button"
                  role="checkbox"
                  aria-checked={on}
                  disabled={blocked && !on}
                  onClick={() => toggle(pi, s.id)}
                  className={cn(
                    'flex min-h-14 w-full min-w-0 cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                    on ? 'border-forest-800 bg-forest-50 ring-1 ring-forest-800' : 'border-line-strong bg-surface hover:bg-forest-50/60',
                  )}
                >
                  <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded border', on ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong')}>
                    {on && <Check className="size-3.5" aria-hidden />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="text-sm font-semibold">{s.name}</span>
                      <span className="shrink-0 text-sm font-semibold tabular">{formatZAR(s.priceCents)}</span>
                    </span>
                    <span className="block text-[12px] text-ink-muted">
                      {durationLabel(s.durationMinutes)}
                      {blocked && ' · not offered as a house call'}
                      {s.description && !blocked && ` · ${s.description}`}
                    </span>
                  </span>
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}
      {people.length < maxPeople && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => onChange([...(people.length === 1 && !people[0].label ? [{ ...people[0], label: 'Person 1' }] : people), { label: `Person ${people.length + 1}`, serviceIds: [] }])}
        >
          <Plus /> Add another person
        </Button>
      )}
    </div>
  )
}
