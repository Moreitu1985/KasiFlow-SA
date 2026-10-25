import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Plus, SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Input, NativeSelect } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RoleHeader } from '@/features/access/RoleHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { Initials } from '@/components/shared/HeroPanel'
import { StaffStatusBadge } from '@/components/shared/StatusBadges'
import { addDays, todayJhb } from '@/lib/format'
import { BOOKING_STATUS_LABELS, formatDayLabel, jhbDate, weekdayOf } from '@/lib/barbershop'
import { entries } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { useAccess } from '@/features/access/useAccess'
import { useTeam } from '@/features/team/api'
import type { BookingSummaryDto } from '@/types/barbershop'
import { useBookings } from './api'
import { BookingListItem } from './BookingListItem'
import { BookingQuickActions } from './QuickActions'
import { NewBookingDialog } from './NewBookingDialog'

type Mode = 'day' | 'week' | 'range'

function mondayOf(ymd: string) {
  return addDays(ymd, -((weekdayOf(ymd) + 6) % 7))
}

export function BookingsPage() {
  const { can } = useAccess()
  const [params, setParams] = useSearchParams()
  const today = todayJhb()
  const mode = (params.get('view') as Mode | null) ?? 'day'
  const anchor = params.get('date') ?? today
  const status = params.get('status') ?? ''
  const staffId = params.get('staff') ?? ''
  const locationType = params.get('where') ?? ''
  const [rangeFrom, setRangeFrom] = useState(params.get('from') ?? today)
  const [rangeTo, setRangeTo] = useState(params.get('to') ?? addDays(today, 13))
  const [creating, setCreating] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const team = useTeam(can('viewTeamStatus', 'viewStaff', 'manageBookings', 'manageStaffSchedules'))

  const { from, to } =
    mode === 'day' ? { from: anchor, to: anchor } : mode === 'week' ? { from: mondayOf(anchor), to: addDays(mondayOf(anchor), 6) } : { from: rangeFrom, to: rangeTo }
  const q = useBookings({ from, to, status: status || undefined, staffId: staffId || undefined, locationType: locationType || undefined })

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    setParams(next, { replace: true })
  }
  const step = (dir: 1 | -1) => set({ date: addDays(anchor, dir * (mode === 'week' ? 7 : 1)) })

  const groups = useMemo(() => {
    const out: { day: string; items: BookingSummaryDto[] }[] = []
    for (const b of q.data ?? []) {
      const day = jhbDate(b.startsAt)
      const g = out.find((x) => x.day === day)
      if (g) g.items.push(b)
      else out.push({ day, items: [b] })
    }
    return out
  }, [q.data])

  const label = mode === 'day' ? (anchor === today ? `Today, ${formatDayLabel(anchor)}` : formatDayLabel(anchor)) : mode === 'week' ? `${formatDayLabel(from)} – ${formatDayLabel(to)}` : ''
  // Front desk and managers see at a glance who can take a walk-in (statuses are set by each barber).
  const freeBoard = useMemo(
    () =>
      can('viewTeamStatus', 'manageBookings') && mode === 'day' && anchor === today
        ? [...(team.data ?? [])].filter((t) => t.isActive && t.isBookable).sort((a, b) => Number(b.status.availableNow) - Number(a.status.availableNow))
        : [],
    [can, mode, anchor, today, team.data],
  )
  const activeFilters = [status, staffId, locationType].filter(Boolean).length
  const waiting = (q.data ?? []).filter((b) => b.status === 'requested' || (b.status === 'reschedule_proposed' && b.proposedBy === 'customer')).length

  return (
    <div className="space-y-5">
      <RoleHeader
        title="Bookings"
        description="Requests, confirmed appointments and house calls. Tap a booking to confirm, take payment or mark it done. Times are South African time."
       
        actions={
          can('manageBookings') && (
            <Button onClick={() => setCreating(true)}>
              <Plus /> New booking
            </Button>
          )
        }
      />

      <div className="space-y-3 rounded-xl border border-line bg-surface p-3 shadow-card sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-line-strong p-0.5" role="group" aria-label="View">
            {(['day', 'week', 'range'] as const).map((m) => (
              <button
                key={m}
                type="button"
                aria-pressed={mode === m}
                onClick={() => set({ view: m === 'day' ? '' : m })}
                className={cn('h-10 cursor-pointer rounded-md px-3.5 text-[13px] font-semibold', mode === m ? 'bg-primary text-primary-fg' : 'text-ink-soft hover:bg-forest-50')}
              >
                {m === 'day' ? 'Day' : m === 'week' ? 'Week' : 'Dates'}
              </button>
            ))}
          </div>
          {mode !== 'range' && (
            <div className="flex min-w-0 items-center gap-1">
              <Button variant="outline" size="icon-sm" aria-label={mode === 'week' ? 'Previous week' : 'Previous day'} onClick={() => step(-1)}>
                <ChevronLeft />
              </Button>
              <p className="min-w-0 px-1 text-sm font-semibold" aria-live="polite">
                {label}
              </p>
              <Button variant="outline" size="icon-sm" aria-label={mode === 'week' ? 'Next week' : 'Next day'} onClick={() => step(1)}>
                <ChevronRight />
              </Button>
              {anchor !== today && (
                <Button variant="ghost" size="sm" onClick={() => set({ date: '' })}>
                  Today
                </Button>
              )}
            </div>
          )}
          {mode === 'range' && (
            <div className="grid w-full grid-cols-2 gap-2 sm:w-auto">
              <div>
                <Label htmlFor="bk-from" className="sr-only">From</Label>
                <Input id="bk-from" type="date" value={rangeFrom} max={rangeTo} onChange={(e) => setRangeFrom(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="bk-to" className="sr-only">To</Label>
                <Input id="bk-to" type="date" value={rangeTo} min={rangeFrom} onChange={(e) => setRangeTo(e.target.value)} />
              </div>
            </div>
          )}
        </div>
        <button
          type="button"
          aria-expanded={showFilters}
          aria-controls="bk-filters"
          onClick={() => setShowFilters((v) => !v)}
          className="flex min-h-11 w-full cursor-pointer items-center justify-between rounded-lg border border-line-strong px-3 text-sm font-semibold sm:hidden"
        >
          <span className="inline-flex items-center gap-2">
            <SlidersHorizontal className="size-4" aria-hidden /> Filters
            {activeFilters > 0 && <span className="rounded-full bg-primary px-2 py-0.5 text-[12px] text-primary-fg">{activeFilters}</span>}
          </span>
          <ChevronDown className={cn('size-4 transition-transform', showFilters && 'rotate-180')} aria-hidden />
        </button>
        <div id="bk-filters" className={cn('grid-cols-1 gap-2 sm:grid sm:grid-cols-3', showFilters ? 'grid' : 'hidden')}>
          <div className="min-w-0">
            <Label htmlFor="bk-status" className="text-[13px]">Status</Label>
            <NativeSelect id="bk-status" className="mt-1" value={status} onChange={(e) => set({ status: e.target.value })}>
              <option value="">All statuses</option>
              {entries(BOOKING_STATUS_LABELS).map(([k, l]) => (
                <option key={k} value={k}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="min-w-0">
            <Label htmlFor="bk-staff" className="text-[13px]">Barber</Label>
            <NativeSelect id="bk-staff" className="mt-1" value={staffId} onChange={(e) => set({ staff: e.target.value })} disabled={!team.data}>
              <option value="">All barbers</option>
              {(team.data ?? []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.displayName}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="min-w-0">
            <Label htmlFor="bk-where" className="text-[13px]">Where</Label>
            <NativeSelect id="bk-where" className="mt-1" value={locationType} onChange={(e) => set({ where: e.target.value })}>
              <option value="">Shop and house calls</option>
              <option value="in_shop">In the shop</option>
              <option value="house_call">House calls</option>
            </NativeSelect>
          </div>
        </div>
      </div>

      {freeBoard.length > 0 && (
        <section aria-labelledby="free-h" className="min-w-0">
          <h2 id="free-h" className="mb-2 text-sm font-semibold text-ink-soft">
            Who’s free right now
          </h2>
          <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
            {freeBoard.map((t) => (
              <li key={t.id} className="flex shrink-0 items-center gap-2 rounded-full border border-line bg-surface py-1 pr-2 pl-1 shadow-card">
                <Initials name={t.displayName} className={cn('size-8 text-[12px]', t.status.availableNow && 'bg-emerald-100 text-emerald-900')} />
                <span className="text-sm font-semibold">{t.displayName.replace(/\s*\(.*\)$/, '')}</span>
                <StaffStatusBadge status={t.status.status} label={t.status.label} stale={t.status.stale} />
              </li>
            ))}
          </ul>
        </section>
      )}

      {waiting > 0 && (
        <p className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-2.5 text-sm text-sky-950">
          {waiting} {waiting === 1 ? 'booking is' : 'bookings are'} waiting for an answer from the business.
        </p>
      )}

      {q.isLoading ? (
        <ListSkeleton rows={5} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : groups.length === 0 ? (
        <EmptyState
          icon={CalendarDays}
          title="No bookings"
          description={status || staffId || locationType ? 'Nothing matches these filters.' : 'Nothing booked for these dates.'}
          action={can('manageBookings') ? <Button onClick={() => setCreating(true)}><Plus /> New booking</Button> : undefined}
        />
      ) : (
        <div className="space-y-4">
          {groups.map((g) => (
            <Card key={g.day} className="min-w-0 overflow-hidden">
              <h2 className="border-b border-line bg-paper/70 px-4 py-2 font-sans text-sm font-semibold">
                {g.day === today ? 'Today · ' : ''}
                {formatDayLabel(g.day)} <span className="font-normal text-ink-muted">· {g.items.length}</span>
              </h2>
              <ul className="divide-y divide-line">
                {g.items.map((b) => (
                  <BookingListItem key={b.id} b={b} actions={<BookingQuickActions b={b} />} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
      <NewBookingDialog open={creating} onOpenChange={setCreating} />
    </div>
  )
}
