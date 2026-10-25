import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Car, Eye, EyeOff, Pencil, Plus, Tags } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Money } from '@/components/shared/Money'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { RoleHeader } from '@/features/access/RoleHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { centsToRandInput, parseRandToCents } from '@/lib/format'
import { durationLabel } from '@/lib/barbershop'
import { useAccess } from '@/features/access/useAccess'
import { useSaveService, useServices, useSetStaffServices, useTeam } from '@/features/team/api'
import type { ServiceDto, StaffProfileDto } from '@/types/barbershop'

function ServiceDialog({ service, open, onOpenChange, nextSort }: { service: ServiceDto | null; open: boolean; onOpenChange: (o: boolean) => void; nextSort: number }) {
  const save = useSaveService()
  const [v, setV] = useState({ name: '', description: '', category: '', price: '', duration: '30', isActive: true, isPublic: true, allowsHouseCall: true, sortOrder: '0' })
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!open) return
    setErrors({})
    setV(
      service
        ? {
            name: service.name,
            description: service.description ?? '',
            category: service.category ?? '',
            price: centsToRandInput(service.priceCents),
            duration: String(service.durationMinutes),
            isActive: service.isActive,
            isPublic: service.isPublic,
            allowsHouseCall: service.allowsHouseCall,
            sortOrder: String(service.sortOrder),
          }
        : { name: '', description: '', category: '', price: '', duration: '30', isActive: true, isPublic: true, allowsHouseCall: true, sortOrder: String(nextSort) },
    )
  }, [open, service, nextSort])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const price = parseRandToCents(v.price)
    const duration = Number.parseInt(v.duration, 10)
    const err: Record<string, string> = {}
    if (!v.name.trim()) err.name = 'Enter a name.'
    if (price === null) err.priceCents = 'Enter a price like 80 or 80.50.'
    if (!(duration >= 5 && duration <= 480)) err.durationMinutes = 'Between 5 and 480 minutes.'
    setErrors(err)
    if (Object.keys(err).length) return
    save.mutate(
      {
        id: service?.id,
        input: {
          name: v.name.trim(),
          description: v.description.trim() || null,
          category: v.category.trim() || null,
          priceCents: price ?? 0,
          durationMinutes: duration,
          isActive: v.isActive,
          isPublic: v.isPublic,
          allowsHouseCall: v.allowsHouseCall,
          sortOrder: Number.parseInt(v.sortOrder, 10) || 0,
        },
      },
      {
        onSuccess: () => {
          toast.success(service ? 'Service updated' : 'Service added')
          onOpenChange(false)
        },
        onError: (er) => {
          if (er instanceof ApiError && Object.keys(er.errors).length) setErrors(Object.fromEntries(Object.entries(er.errors).map(([k, x]) => [k, x[0]])))
          else toast.error('Could not save the service', { description: errorMessage(er) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{service ? `Edit ${service.name}` : 'New service'}</DialogTitle>
            <DialogDescription>Price changes apply to new bookings only. Existing bookings keep their price.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <Field id="sv-name" label="Name" error={errors.name}>
              <Input maxLength={80} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field id="sv-price" label="Price" error={errors.priceCents}>
                <MoneyInput value={v.price} onChange={(e) => setV({ ...v, price: e.target.value })} />
              </Field>
              <Field id="sv-dur" label="Minutes" error={errors.durationMinutes}>
                <Input inputMode="numeric" value={v.duration} onChange={(e) => setV({ ...v, duration: e.target.value })} />
              </Field>
              <Field id="sv-cat" label="Category" optional error={errors.category}>
                <Input maxLength={40} value={v.category} onChange={(e) => setV({ ...v, category: e.target.value })} placeholder="Hair, Beard…" />
              </Field>
              <Field id="sv-sort" label="Sort order" optional>
                <Input inputMode="numeric" value={v.sortOrder} onChange={(e) => setV({ ...v, sortOrder: e.target.value })} />
              </Field>
            </div>
            <Field id="sv-desc" label="Description" optional error={errors.description}>
              <Textarea rows={2} maxLength={300} value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} />
            </Field>
            {(
              [
                ['isActive', 'Active', 'Inactive services cannot be booked.'],
                ['isPublic', 'Show on the public booking page', 'Off: only the team can book it.'],
                ['allowsHouseCall', 'Can be done as a house call', ''],
              ] as const
            ).map(([k, label, hint]) => (
              <div key={k} className="flex items-start justify-between gap-3">
                <div>
                  <Label htmlFor={`sv-${k}`}>{label}</Label>
                  {hint && <p className="text-[13px] text-ink-muted">{hint}</p>}
                </div>
                <Switch id={`sv-${k}`} checked={v[k]} onCheckedChange={(c) => setV({ ...v, [k]: c })} />
              </div>
            ))}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={save.isPending}>
              Save service
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Catalogue({ canEdit }: { canEdit: boolean }) {
  const q = useServices(true)
  const [editing, setEditing] = useState<{ open: boolean; service: ServiceDto | null }>({ open: false, service: null })
  const nextSort = ((q.data ?? []).reduce((m, s) => Math.max(m, s.sortOrder), 0) || 0) + 10
  return (
    <div className="space-y-4">
      {canEdit && (
        <Button onClick={() => setEditing({ open: true, service: null })}>
          <Plus /> New service
        </Button>
      )}
      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={Tags} title="No services yet" description="Add what you offer, with a price and how long it takes." />
      ) : (
        <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
          {q.data.map((s) => (
            <li key={s.id} className={`flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center ${s.isActive ? '' : 'opacity-60'}`}>
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {s.name} {s.category && <span className="text-[13px] font-normal text-ink-muted">· {s.category}</span>}
                </p>
                {s.description && <p className="text-[13px] text-ink-soft">{s.description}</p>}
                <p className="mt-1 flex flex-wrap gap-1.5">
                  {!s.isActive && <Badge variant="neutral">Inactive</Badge>}
                  <Badge variant={s.isPublic ? 'info' : 'neutral'}>
                    {s.isPublic ? <Eye aria-hidden /> : <EyeOff aria-hidden />} {s.isPublic ? 'Public' : 'Team only'}
                  </Badge>
                  {s.allowsHouseCall && (
                    <Badge variant="outline">
                      <Car aria-hidden /> House call
                    </Badge>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-3 sm:text-right">
                <div>
                  <Money cents={s.priceCents} className="font-semibold" />
                  <p className="text-[12px] text-ink-muted">{durationLabel(s.durationMinutes)}</p>
                </div>
                {canEdit && (
                  <Button size="sm" variant="outline" onClick={() => setEditing({ open: true, service: s })}>
                    <Pencil /> Edit
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ServiceDialog service={editing.service} open={editing.open} onOpenChange={(o) => setEditing((x) => ({ ...x, open: o }))} nextSort={nextSort} />
    </div>
  )
}

function BarberServices({ person, services, canEdit }: { person: StaffProfileDto; services: ServiceDto[]; canEdit: boolean }) {
  const save = useSetStaffServices()
  const initial = useMemo(() => {
    const m: Record<string, { on: boolean; price: string }> = {}
    for (const s of services) {
      const own = person.services.find((x) => x.serviceId === s.id)
      m[s.id] = { on: !!own, price: own?.hasOwnPrice ? centsToRandInput(own.priceCents) : '' }
    }
    return m
  }, [person, services])
  const [draft, setDraft] = useState(initial)
  useEffect(() => setDraft(initial), [initial])
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial)
  const [error, setError] = useState<string>()

  const submit = () => {
    const input = []
    for (const s of services) {
      const d = draft[s.id]
      if (!d?.on) continue
      const price = d.price.trim() ? parseRandToCents(d.price) : null
      if (d.price.trim() && price === null) return setError(`${s.name}: enter a price like 90 or leave it empty to use ${centsToRandInput(s.priceCents)}.`)
      input.push({ serviceId: s.id, priceCents: price })
    }
    setError(undefined)
    save.mutate(
      { staffId: person.id, input },
      { onSuccess: () => toast.success(`Services saved for ${person.displayName}`), onError: (e) => toast.error('Could not save', { description: errorMessage(e) }) },
    )
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="font-sans">{person.displayName}</CardTitle>
        <CardDescription>{person.roleTitle}. Leave “own price” empty to use the standard price.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y divide-line">
          {services.map((s) => {
            const d = draft[s.id] ?? { on: false, price: '' }
            return (
              <li key={s.id} className="flex flex-wrap items-center gap-3 py-2">
                <label className="flex min-w-0 flex-1 items-center gap-2.5 text-sm">
                  <Checkbox disabled={!canEdit} checked={d.on} onChange={(e) => setDraft({ ...draft, [s.id]: { ...d, on: e.target.checked } })} />
                  <span className="min-w-0">
                    {s.name} <span className="text-[12px] text-ink-muted">· standard <Money cents={s.priceCents} /></span>
                  </span>
                </label>
                <div className="w-32">
                  <Label htmlFor={`own-${person.id}-${s.id}`} className="sr-only">
                    Own price for {s.name}
                  </Label>
                  <MoneyInput
                    id={`own-${person.id}-${s.id}`}
                    className="h-9"
                    placeholder="Own price"
                    disabled={!canEdit || !d.on}
                    value={d.price}
                    onChange={(e) => setDraft({ ...draft, [s.id]: { ...d, price: e.target.value } })}
                  />
                </div>
              </li>
            )
          })}
        </ul>
        {error && <p role="alert" className="text-[13px] font-medium text-red-700">{error}</p>}
        {canEdit && (
          <Button size="sm" disabled={!dirty} loading={save.isPending} onClick={submit}>
            Save {person.displayName.split(' ')[0]}’s services
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function PerBarber({ canEdit }: { canEdit: boolean }) {
  const team = useTeam()
  const services = useServices(false)
  const [who, setWho] = useState('')
  if (team.isLoading || services.isLoading) return <ListSkeleton rows={3} />
  if (team.isError) return <ErrorState error={team.error} onRetry={() => team.refetch()} />
  const people = (team.data ?? []).filter((t) => t.isActive)
  const shown = who ? people.filter((p) => p.id === who) : people
  return (
    <div className="space-y-4">
      <div className="max-w-xs">
        <Label htmlFor="pb-who">Barber</Label>
        <NativeSelect id="pb-who" className="mt-1.5" value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Everyone</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.displayName}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {shown.map((p) => (
          <BarberServices key={p.id} person={p} services={services.data ?? []} canEdit={canEdit} />
        ))}
      </div>
    </div>
  )
}

export function ServicesPage() {
  const { can } = useAccess()
  const canEdit = can('manageServices')
  return (
    <div className="space-y-5">
      <RoleHeader title="Services & prices" description="What you offer, how long it takes and what it costs. Each barber can have their own price." />
      <Tabs defaultValue="catalogue">
        <TabsList>
          <TabsTrigger value="catalogue">Service list</TabsTrigger>
          {can('manageServices', 'viewStaff', 'viewTeamStatus') && <TabsTrigger value="barbers">Per barber</TabsTrigger>}
        </TabsList>
        <TabsContent value="catalogue">
          <Catalogue canEdit={canEdit} />
        </TabsContent>
        <TabsContent value="barbers">
          <PerBarber canEdit={canEdit} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
