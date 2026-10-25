import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Camera, Car, ChevronRight, Clock, Coffee, Store, UserPlus, UserX, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { HeroPanel } from '@/components/shared/HeroPanel'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { Callout } from '@/components/shared/Callout'
import { Money } from '@/components/shared/Money'
import { StaffStatusBadge } from '@/components/shared/StatusBadges'
import { formatDayLabel, formatTime, jhbDate } from '@/lib/barbershop'
import { todayJhb } from '@/lib/format'
import { houseCallsNeedingSafety, nextCustomer } from '@/lib/customer'
import { AppBadge } from '@/layouts/shell'
import { SafetyPanel } from '@/features/safety/SafetyPanel'
import { PortfolioManager } from '@/features/portfolio/PortfolioManager'
import { useAccess } from '@/features/access/useAccess'
import { BookingListItem } from '@/features/bookings/BookingListItem'
import { BookingQuickActions } from '@/features/bookings/QuickActions'
import type { BookingSummaryDto, StaffProfileDto } from '@/types/barbershop'
import { useWorkspace } from '@/features/team/api'
import { StatusUpdater } from './StatusUpdater'
import { HoursEditor } from './HoursEditor'
import { TimeOffCard } from './TimeOffCard'
import { TeamStatusList } from './TeamStatusList'
import { WalkInsCard } from '@/features/queue/WalkInsCard'

function groupByDay(list: BookingSummaryDto[]) {
  const out: { day: string; items: BookingSummaryDto[] }[] = []
  for (const b of list) {
    const day = jhbDate(b.startsAt)
    const g = out.find((x) => x.day === day)
    if (g) g.items.push(b)
    else out.push({ day, items: [b] })
  }
  return out
}

/** "Right now": the barber's own status, as the team and customers see it. */
function NowTile({ profile }: { profile: StaffProfileDto }) {
  const s = profile.status
  return (
    <div className="flex min-w-0 flex-col rounded-xl border border-white/12 bg-white/6 p-4">
      <p className="text-[13px] font-medium text-cream">Right now</p>
      <div className="mt-2">
        <StaffStatusBadge status={s.status} label={s.label} stale={s.stale} className="px-3 py-1.5 text-[15px] [&>span:first-child]:size-2.5" />
      </div>
      <p className="mt-2 text-[13px] text-cream/90">
        {s.expiresAt ? `Until ${formatTime(s.expiresAt)}` : 'Until you change it'}
        {s.note ? ` · “${s.note}”` : ''}
      </p>
      <a href="#my-status" className="mt-auto inline-flex min-h-11 items-center gap-1 pt-2 text-sm font-semibold text-gold hover:underline">
        Change my status <ChevronRight className="size-4" aria-hidden />
      </a>
    </div>
  )
}

/** The next customer, big enough to read at arm's length. Shows only this barber's own booking price. */
function NextTile({ b }: { b: BookingSummaryDto | null }) {
  if (!b)
    return (
      <div className="flex min-w-0 flex-col justify-center rounded-xl border border-dashed border-white/25 p-4">
        <Coffee className="size-6 text-gold" aria-hidden />
        <p className="mt-2 font-semibold text-white">No more customers booked today</p>
        <p className="text-[13px] text-cream/90">Walk-ins can still find you when your status says Available.</p>
      </div>
    )
  const house = b.locationType === 'house_call'
  return (
    <div className="flex min-w-0 flex-col rounded-xl bg-surface p-4 text-ink shadow-raised">
      <p className="text-[13px] font-semibold text-forest-800">Next customer</p>
      <Link to={`/bookings/${b.id}`} className="group mt-1.5 flex min-w-0 items-center gap-3">
        <div className="shrink-0 rounded-lg bg-primary px-3 py-2 text-center text-primary-fg">
          <p className="font-display text-2xl leading-none font-bold tabular">{formatTime(b.startsAt)}</p>
          <p className="mt-1 text-[11px] text-cream">to {formatTime(b.endsAt)}</p>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold group-hover:underline">{b.customerName}</p>
          <p className="truncate text-sm text-ink-soft">{b.servicesSummary}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 text-[13px] text-ink-muted">
            <span className="inline-flex items-center gap-1">
              {house ? <Car className="size-3.5" aria-hidden /> : <Store className="size-3.5" aria-hidden />}
              {house ? 'House call' : 'In the shop'}
            </span>
            <Money cents={b.totalCents} />
          </p>
        </div>
        <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
      </Link>
      <div className="mt-3 flex flex-wrap gap-2 empty:hidden">
        <BookingQuickActions b={b} />
      </div>
    </div>
  )
}

/**
 * /workspace — the barber's own app, phone first: status and next customer up top, today's list, house-call safety,
 * then their work, hours and team in tabs so the first screen stays calm. No shop money beyond their own bookings.
 */
export function WorkspacePage() {
  const q = useWorkspace()
  const { can, experience } = useAccess()
  const w = q.data
  const profileId = w?.profile?.id ?? null
  // Recomputed when the workspace refreshes (every 30 s), which keeps "next customer" current enough.
  const next = useMemo(() => (w ? nextCustomer(w.today, Date.now()) : null), [w])
  const houseCalls = useMemo(() => (w && profileId ? houseCallsNeedingSafety(w.today, profileId) : []), [w, profileId])
  // Customers still to see vs. visits whose time has passed but are not marked done yet (same refresh as above).
  const { toSee, toClose } = useMemo(() => {
    const now = Date.now()
    const open = (w?.today ?? []).filter((b) => b.status === 'confirmed' || b.status === 'requested' || b.status === 'reschedule_proposed')
    const later = open.filter((b) => new Date(b.endsAt).getTime() > now).length
    return { toSee: later, toClose: open.length - later }
  }, [w])

  const actions = (
    <>
      {can('manageStaff') && (
        <Button asChild variant="accent">
          <Link to="/team/register">
            <UserPlus /> Register a barber
          </Link>
        </Button>
      )}
      {can('viewBookings', 'manageBookings', 'workOwnBookings') && (
        <Button asChild variant="outline" className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white">
          <Link to="/bookings">
            <CalendarDays /> All my bookings
          </Link>
        </Button>
      )}
    </>
  )

  return (
    <div className="space-y-6">
      <HeroPanel as="header">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <AppBadge experience={experience} who={w?.profile?.displayName} tone="dark" />
            <h1 className="mt-3 text-[2rem] leading-tight font-bold text-white sm:text-[2.4rem]">My day</h1>
            <p className="mt-1 text-[15px] text-cream">
              {formatDayLabel(todayJhb())}
              {w?.profile && ` · ${toSee === 0 ? 'no customers left to see' : `${toSee} ${toSee === 1 ? 'customer' : 'customers'} still to see`}`}
              {w?.profile && toClose > 0 && ` · ${toClose} ${toClose === 1 ? 'visit' : 'visits'} to mark done`}
            </p>
          </div>
          <div className="hidden flex-wrap gap-2 sm:flex">{actions}</div>
        </div>
        {w?.profile && (
          <div className="mt-5 grid min-w-0 gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
            <NowTile profile={w.profile} />
            <NextTile b={next} />
          </div>
        )}
      </HeroPanel>

      {q.isLoading ? (
        <ListSkeleton rows={4} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !w ? null : !w.profile ? (
        <>
          <EmptyState icon={UserX} title="No team profile linked to your login" description={w.hint ?? 'Ask the owner to link your login to a team profile.'} />
          {w.team.length > 0 && <TeamStatusList team={w.team} />}
        </>
      ) : (
        // Phone: one column in the order a barber needs it (safety, today, status, the rest). Wide: two columns.
        <div className="flex min-w-0 flex-col gap-6 xl:grid xl:grid-cols-5 xl:items-start">
          <div className="contents xl:col-span-3 xl:block xl:min-w-0 xl:space-y-6">
            {houseCalls.map((b) => (
              <SafetyPanel key={b.id} bookingId={b.id} title={`House-call safety: ${b.customerName} at ${formatTime(b.startsAt)}`} className="order-1 border-2 border-forest-800/30" />
            ))}

            {experience.has('queue') && <WalkInsCard staffId={profileId} className="order-2" />}

            <Card className="order-2 min-w-0 overflow-hidden">
              <CardHeader className="flex-row items-center justify-between gap-2">
                <CardTitle className="text-lg">Today</CardTitle>
                <span className="text-[13px] text-ink-muted">
                  {w.today.length} {w.today.length === 1 ? 'booking' : 'bookings'}
                </span>
              </CardHeader>
              {w.today.length === 0 ? (
                <CardContent>
                  <p className="text-sm text-ink-muted">No appointments today. Keep your status up to date so walk-ins know you are free.</p>
                </CardContent>
              ) : (
                <ul className="divide-y divide-line border-t border-line">
                  {w.today.map((b) => (
                    <BookingListItem key={b.id} b={b} showStaff={false} actions={<BookingQuickActions b={b} />} />
                  ))}
                </ul>
              )}
            </Card>

            <Tabs defaultValue="upcoming" className="order-5 min-w-0">
              <TabsList aria-label="More about your work">
                <TabsTrigger value="upcoming">
                  <CalendarDays className="size-4" aria-hidden /> Coming up
                </TabsTrigger>
                <TabsTrigger value="work">
                  <Camera className="size-4" aria-hidden /> My work
                </TabsTrigger>
                <TabsTrigger value="hours">
                  <Clock className="size-4" aria-hidden /> Hours & time off
                </TabsTrigger>
                <TabsTrigger value="team" className="xl:hidden">
                  <Users className="size-4" aria-hidden /> Team
                </TabsTrigger>
              </TabsList>
              <TabsContent value="upcoming">
                <Card className="min-w-0 overflow-hidden">
                  {w.upcoming.length === 0 ? (
                    <CardContent className="pt-5">
                      <p className="text-sm text-ink-muted">Nothing booked for the next two weeks.</p>
                    </CardContent>
                  ) : (
                    groupByDay(w.upcoming).map((g, i) => (
                      <div key={g.day} className={i > 0 ? 'border-t border-line' : undefined}>
                        <p className="bg-paper/70 px-4 py-2 text-[13px] font-semibold text-ink-muted">{formatDayLabel(g.day)}</p>
                        <ul className="divide-y divide-line">
                          {g.items.map((b) => (
                            <BookingListItem key={b.id} b={b} showStaff={false} actions={<BookingQuickActions b={b} />} />
                          ))}
                        </ul>
                      </div>
                    ))
                  )}
                </Card>
              </TabsContent>
              <TabsContent value="work">
                <PortfolioManager staffId={w.profile.id} services={w.profile.services} />
              </TabsContent>
              <TabsContent value="hours" className="space-y-6">
                <HoursEditor key={JSON.stringify(w.profile.hours)} staffId={w.profile.id} hours={w.profile.hours} />
                <TimeOffCard staffId={w.profile.id} items={w.timeOff} />
              </TabsContent>
              <TabsContent value="team" className="xl:hidden">
                <TeamStatusList team={w.team.filter((t) => !t.isYou)} title="Colleagues" />
              </TabsContent>
            </Tabs>
          </div>

          <div className="contents xl:col-span-2 xl:block xl:min-w-0 xl:space-y-6">
            <div id="my-status" className="order-3 min-w-0 scroll-mt-20">
              <StatusUpdater key={w.profile.status.updatedAt + w.profile.status.status} profile={w.profile} />
            </div>
            {!w.profile.isBookable && (
              <Callout tone="info" title="You are not bookable" className="order-4">
                The owner has switched off bookings for your profile, so customers cannot choose you.
              </Callout>
            )}
            <div className="hidden xl:block">
              <TeamStatusList team={w.team.filter((t) => !t.isYou)} title="Colleagues" />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
