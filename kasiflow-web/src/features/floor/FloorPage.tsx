import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertOctagon,
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  Car,
  CheckCircle2,
  ChevronRight,
  Clock,
  Hourglass,
  Info,
  LifeBuoy,
  Plus,
  RefreshCw,
  ShieldAlert,
  UserX,
  Users,
  Wallet,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { HeroPanel, HeroStat, Initials } from '@/components/shared/HeroPanel'
import { AnimatedNumber } from '@/components/shared/AnimatedNumber'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { StaffStatusBadge } from '@/components/shared/StatusBadges'
import { formatDayLabel, formatTime } from '@/lib/barbershop'
import { chairsByBarber, sortAttention, teamBoard } from '@/lib/floor'
import { cn } from '@/lib/utils'
import { AppBadge } from '@/layouts/shell'
import { useAccess } from '@/features/access/useAccess'
import { useBusiness } from '@/features/business/BusinessProvider'
import { BookingListItem } from '@/features/bookings/BookingListItem'
import { BookingQuickActions } from '@/features/bookings/QuickActions'
import { NewBookingDialog } from '@/features/bookings/NewBookingDialog'
import type { BookingSummaryDto, FloorAttentionDto, FloorDto, FloorHouseCallDto, FloorTeamMemberDto } from '@/types/barbershop'
import { FLOOR_REFETCH_MS, useFloor } from './api'
import { WalkInsCard } from '@/features/queue/WalkInsCard'

const KIND_ICON: Record<string, LucideIcon> = { safety: LifeBuoy, bookings: CalendarClock, alerts: ShieldAlert, shifts: Wallet, team: Users }

const SEVERITY_STYLE = {
  critical: { box: 'border-red-300 bg-red-50 hover:bg-red-100/70', icon: 'bg-red-700 text-white', label: 'Critical', LabelIcon: AlertOctagon, text: 'text-red-900' },
  warning: { box: 'border-amber-300 bg-amber-50/70 hover:bg-amber-100/60', icon: 'bg-amber-500 text-forest-950', label: 'Warning', LabelIcon: AlertTriangle, text: 'text-amber-950' },
  informational: { box: 'border-sky-200 bg-sky-50/70 hover:bg-sky-100/60', icon: 'bg-sky-700 text-white', label: 'For your information', LabelIcon: Info, text: 'text-sky-950' },
} as const

function AttentionItem({ a }: { a: FloorAttentionDto }) {
  const s = SEVERITY_STYLE[a.severity] ?? SEVERITY_STYLE.informational
  const Icon = KIND_ICON[a.kind] ?? Info
  const big = a.severity === 'critical' && a.kind === 'safety'
  return (
    <li>
      <Link to={a.link} className={cn('flex min-h-16 items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors', s.box, big && 'border-2 py-4')}>
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-full', s.icon)} aria-hidden>
          <Icon className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className={cn('flex items-center gap-1 text-[12px] font-semibold', s.text)}>
            <s.LabelIcon className="size-3.5 shrink-0" aria-hidden /> {s.label}
          </span>
          <span className={cn('block font-semibold text-ink', big ? 'text-[17px]' : 'text-[15px]')}>{a.title}</span>
          <span className="block text-[13px] leading-snug text-ink-soft">{a.detail}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
      </Link>
    </li>
  )
}

function NeedsAttention({ items }: { items: FloorAttentionDto[] }) {
  const sorted = useMemo(() => sortAttention(items), [items])
  return (
    <section aria-labelledby="attention-h" className="space-y-3">
      <h2 id="attention-h" className="flex items-center gap-2 text-xl font-bold">
        Needs your attention
        {sorted.length > 0 && <Badge variant="neutral">{sorted.length}</Badge>}
      </h2>
      {sorted.length === 0 ? (
        <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-4">
          <CheckCircle2 className="size-6 shrink-0 text-emerald-700" aria-hidden />
          <p className="text-[15px] text-emerald-950">
            <span className="font-semibold">Nothing needs you right now.</span> New requests, late house-call check-ins and alerts will show up here.
          </p>
        </div>
      ) : (
        <ul className="stagger space-y-2.5">
          {sorted.map((a, i) => (
            <AttentionItem key={`${a.kind}-${i}`} a={a} />
          ))}
        </ul>
      )}
    </section>
  )
}

function SafetyStrip({ items }: { items: FloorHouseCallDto[] }) {
  if (items.length === 0) return null
  return (
    <section aria-labelledby="safety-h" className="space-y-3">
      <h2 id="safety-h" className="flex items-center gap-2 text-xl font-bold">
        <Car className="size-5 text-forest-800" aria-hidden /> House calls out now
      </h2>
      <ul className="stagger grid gap-2.5 sm:grid-cols-2">
        {items.map((h) => {
          const alarm = h.helpActive || h.overdue
          return (
            <li key={h.bookingId}>
              <Link
                to={`/bookings/${h.bookingId}`}
                className={cn(
                  'flex min-h-16 items-center gap-3 rounded-xl border bg-surface px-3.5 py-3 shadow-card transition-colors hover:bg-forest-50/60',
                  alarm ? 'border-2 border-red-400' : 'border-line',
                )}
              >
                <Initials name={h.staffName ?? '?'} className={alarm ? 'bg-red-100 text-red-900' : undefined} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{h.staffName ?? 'Unassigned'}</span>
                  <span className="block text-[13px] text-ink-muted">
                    {formatTime(h.startsAt)} · <span className="font-mono">{h.reference}</span>
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    <Badge variant="info">{h.stageLabel}</Badge>
                    {h.helpActive && (
                      <Badge variant="critical">
                        <LifeBuoy aria-hidden /> Help requested
                      </Badge>
                    )}
                    {h.overdue && (
                      <Badge variant="critical">
                        <Hourglass aria-hidden /> Check-in overdue
                      </Badge>
                    )}
                  </span>
                </span>
                <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
              </Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function TeamMember({ m }: { m: FloorTeamMemberDto }) {
  return (
    <li className="flex items-start gap-3 py-3">
      <Initials name={m.displayName} className={m.availableNow ? 'bg-emerald-100 text-emerald-900' : undefined} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <p className="truncate font-semibold">{m.displayName}</p>
          <StaffStatusBadge status={m.status} label={m.statusLabel} />
        </div>
        <p className="text-[13px] text-ink-muted">
          {m.roleTitle} · {m.bookingsToday} {m.bookingsToday === 1 ? 'booking' : 'bookings'} today
        </p>
        <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-soft">
          <Clock className="size-3.5 shrink-0" aria-hidden />
          {m.nextAt ? (
            <>
              Next customer at <span className="font-semibold text-ink tabular">{m.nextAt}</span>
            </>
          ) : (
            'No more bookings today'
          )}
        </p>
        {m.note && <p className="mt-0.5 text-[13px] text-ink-soft">“{m.note}”</p>}
        {m.stale && (
          <p className="mt-1 inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-0.5 text-[12px] font-medium text-amber-900">
            <AlertTriangle className="size-3.5" aria-hidden /> Status not updated for a while: check with them
          </p>
        )}
      </div>
    </li>
  )
}

function WhosFree({ team }: { team: FloorTeamMemberDto[] }) {
  const board = useMemo(() => teamBoard(team), [team])
  const free = board.filter((m) => m.availableNow).length
  return (
    <Card className="min-w-0">
      <CardHeader className="pb-1">
        <CardTitle className="flex items-center gap-2 text-lg">
          <Users className="size-5 text-forest-800" aria-hidden /> Who’s free
        </CardTitle>
        <CardDescription>
          {free === 0 ? 'Nobody has marked themselves free right now.' : `${free} ${free === 1 ? 'barber is' : 'barbers are'} free now.`} Statuses are set by each
          barber.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {board.length === 0 ? (
          <p className="text-sm text-ink-muted">No team profiles yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {board.map((m) => (
              <TeamMember key={m.id} m={m} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function Chairs({ today, onNew }: { today: BookingSummaryDto[]; onNew?: () => void }) {
  const [view, setView] = useState<'barber' | 'time'>('barber')
  const groups = useMemo(() => chairsByBarber(today), [today])
  const byTime = useMemo(() => [...today].sort((a, b) => a.startsAt.localeCompare(b.startsAt)), [today])
  return (
    <section aria-labelledby="chairs-h" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="chairs-h" className="text-xl font-bold">
            Today’s chairs
          </h2>
          <p className="text-sm text-ink-muted">Every booking for today. Tap one to open it.</p>
        </div>
        {today.length > 0 && (
          <div className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5" role="group" aria-label="Group bookings">
            {(
              [
                ['barber', 'By barber'],
                ['time', 'By time'],
              ] as const
            ).map(([k, label]) => (
              <button
                key={k}
                type="button"
                aria-pressed={view === k}
                onClick={() => setView(k)}
                className={cn('h-10 cursor-pointer rounded-md px-3.5 text-[13px] font-semibold', view === k ? 'bg-primary text-primary-fg' : 'text-ink-soft hover:bg-forest-50')}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>
      {today.length === 0 ? (
        <EmptyState
          icon={CalendarCheck}
          title="No bookings for today yet"
          description="Walk-ins and phone bookings can be added from here, so the team sees them too."
          action={
            onNew && (
              <Button onClick={onNew}>
                <Plus /> New booking
              </Button>
            )
          }
        />
      ) : view === 'time' ? (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-line">
            {byTime.map((b) => (
              <BookingListItem key={b.id} b={b} showMoney={false} actions={<BookingQuickActions b={b} />} />
            ))}
          </ul>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((g) => (
            <Card key={g.key} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-line bg-paper/70 px-4 py-2.5">
                <Initials name={g.name} className="size-8 text-[13px]" />
                <p className="min-w-0 flex-1 truncate font-semibold">{g.name}</p>
                <span className="text-[13px] text-ink-muted">
                  {g.items.length} {g.items.length === 1 ? 'booking' : 'bookings'}
                </span>
              </div>
              <ul className="divide-y divide-line">
                {g.items.map((b) => (
                  <BookingListItem key={b.id} b={b} showStaff={false} showMoney={false} actions={<BookingQuickActions b={b} />} />
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </section>
  )
}

function Counters({ f }: { f: FloorDto }) {
  return (
    <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
      <HeroStat hideHintOnPhone label="Requests waiting" value={<AnimatedNumber value={f.requested} />} icon={CalendarClock} tone={f.requested > 0 ? 'attention' : 'default'} hint={f.requested > 0 ? 'Confirm or offer a time' : 'All answered'} />
      <HeroStat hideHintOnPhone label="Confirmed" value={<AnimatedNumber value={f.confirmed} />} icon={CalendarCheck} hint="Still to come today" />
      <HeroStat hideHintOnPhone label="Done" value={<AnimatedNumber value={f.completed} />} icon={CheckCircle2} tone={f.completed > 0 ? 'good' : 'default'} hint="Completed visits" />
      <HeroStat hideHintOnPhone label="No-shows" value={<AnimatedNumber value={f.noShows} />} icon={UserX} tone={f.noShows > 0 ? 'attention' : 'default'} hint="Marked today" />
      <HeroStat hideHintOnPhone label="House calls" value={<AnimatedNumber value={f.houseCalls} />} icon={Car} hint="Booked for today" />
    </div>
  )
}

/**
 * /floor — the manager's (and admin's) live view of today: what needs them, who is free, today's chairs and
 * house-call safety. It shows no money totals: business stats stay with the owner.
 */
export function FloorPage() {
  const q = useFloor()
  const { experience, can } = useAccess()
  const { activeBusiness } = useBusiness()
  const [creating, setCreating] = useState(false)
  const f = q.data
  const updated = q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null

  return (
    <div className="space-y-7">
      <HeroPanel as="header">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <AppBadge experience={experience} who={activeBusiness?.name} tone="dark" />
            <h1 className="mt-3 text-[1.9rem] leading-tight font-bold text-white sm:text-[2.4rem]">Today on the floor</h1>
            <p className="mt-1 text-[15px] text-cream">
              {f ? formatDayLabel(f.date) : 'Today'}
              {updated && (
                <>
                  {' '}
                  · updated {formatTime(updated.toISOString())}, refreshes every {Math.round(FLOOR_REFETCH_MS / 1000)} seconds
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {can('manageBookings') && (
              <Button variant="accent" onClick={() => setCreating(true)}>
                <Plus /> New booking
              </Button>
            )}
            <Button
              variant="outline"
              className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
              loading={q.isFetching && !q.isLoading}
              onClick={() => q.refetch()}
            >
              {!(q.isFetching && !q.isLoading) && <RefreshCw />} Refresh
            </Button>
          </div>
        </div>
        {f ? (
          <Counters f={f} />
        ) : q.isLoading ? (
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5" aria-busy aria-label="Loading">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-24 [--skel-shine:rgb(255_255_255/0.08)] [--skel:rgb(255_255_255/0.07)]" />
            ))}
          </div>
        ) : null}
      </HeroPanel>

      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load today’s floor" />
      ) : f ? (
        // Phone: attention, safety, who's free, then the chairs. Wide: chairs on the left, the team board on the right.
        <div className="flex min-w-0 flex-col gap-7 lg:grid lg:grid-cols-5 lg:items-start">
          <div className="contents lg:col-span-3 lg:block lg:min-w-0 lg:space-y-7">
            <div className="order-1 min-w-0">
              <NeedsAttention items={f.needsAttention} />
            </div>
            {experience.has('queue') && (
              <div className="order-2 min-w-0">
                <WalkInsCard />
              </div>
            )}
            {f.houseCallSafety.length > 0 && (
              <div className="order-2 min-w-0">
                <SafetyStrip items={f.houseCallSafety} />
              </div>
            )}
            <div className="order-4 min-w-0">
              <Chairs today={f.today} onNew={can('manageBookings') ? () => setCreating(true) : undefined} />
            </div>
          </div>
          <div className="order-3 min-w-0 lg:col-span-2">
            <WhosFree team={f.team} />
          </div>
        </div>
      ) : null}

      {can('manageBookings') && <NewBookingDialog open={creating} onOpenChange={setCreating} />}
    </div>
  )
}
