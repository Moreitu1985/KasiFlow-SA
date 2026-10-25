import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import {
  Armchair,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  ChevronDown,
  Clock,
  Hourglass,
  ListOrdered,
  Megaphone,
  Play,
  RefreshCw,
  Smartphone,
  Timer,
  Undo2,
  UserPlus,
  UserRound,
  Users,
  UserX,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AnimatedNumber } from '@/components/shared/AnimatedNumber'
import { Callout } from '@/components/shared/Callout'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { HeroPanel, HeroStat } from '@/components/shared/HeroPanel'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { useNow } from '@/hooks/useNow'
import { errorMessage } from '@/lib/apiClient'
import { formatDayLabel, formatTime } from '@/lib/barbershop'
import { chairProgress, currentTicketFor, displayName, minutesSince, nextTicketFor, queueColumns } from '@/lib/queue'
import { cn } from '@/lib/utils'
import { AppBadge } from '@/layouts/shell'
import { useAccess } from '@/features/access/useAccess'
import { useBusiness } from '@/features/business/BusinessProvider'
import { useServices, useWorkspace } from '@/features/team/api'
import type { StaffProfileDto } from '@/types/barbershop'
import type { QueueAction, QueueBoardDto, QueueTicketDto } from '@/types/pro'
import { QUEUE_REFETCH_MS, useQueueAction, useQueueBoard } from './api'
import { AddWalkInDialog, FinishDialog, SendToBarberDialog } from './QueueDialogs'

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

function TicketNumber({ n, tone = 'default', size = 'md' }: { n: number; tone?: 'default' | 'brass' | 'called'; size?: 'md' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 flex-col items-center justify-center rounded-xl font-display leading-none font-bold tabular',
        size === 'lg' ? 'size-20 text-[2.6rem]' : 'size-14 text-[1.75rem]',
        tone === 'brass' ? 'bg-emerald-brand text-forest-950' : tone === 'called' ? 'bg-primary text-primary-fg' : 'bg-tint-strong text-heading',
      )}
      aria-label={`Ticket ${n}`}
    >
      <span className="text-[10px] font-semibold tracking-wide uppercase opacity-70">No.</span>
      {n}
    </span>
  )
}

interface Handlers {
  desk: boolean
  /** This barber already has someone in the chair (they can call the next person, not start a second cut). */
  busy: boolean
  act: (t: QueueTicketDto, action: QueueAction) => void
  send: (t: QueueTicketDto) => void
  finish: (t: QueueTicketDto) => void
  confirm: (t: QueueTicketDto, action: 'left' | 'no_show') => void
  pending: (t: QueueTicketDto, action: QueueAction) => boolean
}

function TicketActions({ t, h }: { t: QueueTicketDto; h: Handlers }) {
  const can = (a: QueueAction) => t.allowedActions.includes(a)
  const btn = 'h-11'
  return (
    <div className="flex flex-wrap gap-2 empty:hidden">
      {can('done') && (
        <Button variant="accent" className={btn} onClick={() => h.finish(t)}>
          <Banknote /> Done + payment
        </Button>
      )}
      {t.status === 'waiting' && h.desk && (can('call') || can('start')) && (
        <Button className={btn} onClick={() => h.send(t)}>
          <ArrowUpRight /> Send to barber…
        </Button>
      )}
      {t.status === 'waiting' && !h.desk && can('call') && (
        <Button variant="outline" className={btn} loading={h.pending(t, 'call')} onClick={() => h.act(t, 'call')}>
          <Megaphone /> Call
        </Button>
      )}
      {can('start') && (t.status === 'called' || !h.desk) && !(h.busy && !h.desk) && (
        <Button className={btn} loading={h.pending(t, 'start')} onClick={() => h.act(t, 'start')}>
          <Play /> Start
        </Button>
      )}
      {can('requeue') && (
        <Button variant="ghost" className={btn} loading={h.pending(t, 'requeue')} onClick={() => h.act(t, 'requeue')}>
          <Undo2 /> Back to queue
        </Button>
      )}
      {can('no_show') && (
        <Button variant="ghost" className={btn} onClick={() => h.confirm(t, 'no_show')}>
          <UserX /> Didn’t come up
        </Button>
      )}
      {can('left') && (
        <Button variant="ghost" className={cn(btn, 'text-ink-muted')} onClick={() => h.confirm(t, 'left')}>
          Left
        </Button>
      )}
    </div>
  )
}

function ChairCard({ t, h, now }: { t: QueueTicketDto; h: Handlers; now: number }) {
  const p = chairProgress(minutesSince(t.startedAt, now), t.estMinutes)
  return (
    <li className="lift rounded-2xl border border-emerald-brand/50 bg-surface p-4 shadow-card">
      <div className="flex items-start gap-3.5">
        <TicketNumber n={t.number} tone="brass" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold">{displayName(t.customerName)}</p>
          <p className="truncate text-sm text-ink-soft">{t.servicesSummary}</p>
          <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-heading">
            <Armchair className="size-4 text-ochre" aria-hidden /> {t.staffName ?? 'A barber'}
          </p>
        </div>
      </div>
      <div className="mt-3">
        <div className="mb-1 flex items-center justify-between gap-2 text-[12px]">
          <span className={cn('inline-flex items-center gap-1 font-semibold', p.over ? 'text-amber-800' : 'text-ink-soft')}>
            <Timer className="size-3.5" aria-hidden /> {p.label}
          </span>
          <span className="text-ink-muted">since {formatTime(t.startedAt)}</span>
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-tint-strong" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.percent} aria-label="Time in the chair against the estimate">
          <div className={cn('h-full rounded-full transition-[width] duration-700', p.over ? 'bg-amber-500' : 'bg-emerald-brand')} style={{ width: `${p.percent}%` }} />
        </div>
      </div>
      <div className="mt-3">
        <TicketActions t={t} h={h} />
      </div>
    </li>
  )
}

function WaitingRow({ t, h, now }: { t: QueueTicketDto; h: Handlers; now: number }) {
  const called = t.status === 'called'
  return (
    <li className={cn('rounded-2xl border bg-surface p-3.5 shadow-card sm:p-4', called ? 'border-forest-800/40' : 'border-line')}>
      <div className="flex items-start gap-3.5">
        <TicketNumber n={t.number} tone={called ? 'called' : 'default'} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="truncate text-[17px] font-bold">{displayName(t.customerName)}</p>
            {t.source === 'customer' && (
              <Badge variant="info">
                <Smartphone aria-hidden /> Joined by phone
              </Badge>
            )}
          </div>
          <p className="truncate text-sm text-ink-soft">
            {t.servicesSummary} · about {t.estMinutes} min
          </p>
          {called ? (
            <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-semibold text-heading">
              <Megaphone className="size-4 text-ochre" aria-hidden /> Called for {t.staffName ?? 'a barber'} · {minutesSince(t.calledAt, now)} min ago
            </p>
          ) : (
            <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[13px]">
              {t.position != null && <li className="font-semibold text-heading">{ordinal(t.position)} in line</li>}
              {t.waitLabel && (
                <li className="inline-flex items-center gap-1 text-ink-soft">
                  <Hourglass className="size-3.5" aria-hidden /> {t.waitLabel}
                </li>
              )}
              <li className="text-ink-muted">waiting {t.waitedMinutes} min</li>
            </ul>
          )}
          {t.preferredStaffName && !called && (
            <p className="mt-1 inline-flex items-center gap-1 text-[13px] text-ink-soft">
              <UserRound className="size-3.5" aria-hidden /> Asked for {t.preferredStaffName}
            </p>
          )}
        </div>
      </div>
      <div className="mt-3 sm:pl-[4.375rem]">
        <TicketActions t={t} h={h} />
      </div>
    </li>
  )
}

function Section({ title, icon: Icon, count, children, hint }: { title: string; icon: LucideIcon; count: number; children: React.ReactNode; hint?: string }) {
  return (
    <section aria-label={title} className="min-w-0 space-y-3">
      <div className="flex items-end justify-between gap-3">
        <h2 className="flex items-center gap-2 text-xl font-bold">
          <Icon className="size-5 text-forest-800" aria-hidden /> {title}
          <Badge variant="neutral" className="text-[13px]">
            {count}
          </Badge>
        </h2>
        {hint && <p className="text-right text-[12px] text-ink-muted">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/** The barber's own chair: their customer now, or one big "Call next customer". */
function MyChair({ board, me, h, now }: { board: QueueBoardDto; me: StaffProfileDto; h: Handlers; now: number }) {
  const current = currentTicketFor(board.open, me.id)
  const next = nextTicketFor(board.open, me.id)
  if (current) {
    const inChair = current.status === 'in_chair'
    const p = chairProgress(minutesSince(current.startedAt, now), current.estMinutes)
    return (
      <div className="mt-5 flex flex-col gap-4 rounded-xl bg-surface p-4 text-ink shadow-raised sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-4">
          <TicketNumber n={current.number} tone={inChair ? 'brass' : 'called'} size="lg" />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-forest-800">{inChair ? 'In your chair' : 'You called'}</p>
            <p className="truncate text-xl font-bold">{displayName(current.customerName)}</p>
            <p className="truncate text-sm text-ink-soft">{current.servicesSummary}</p>
            <p className={cn('mt-0.5 text-[13px]', p.over && inChair ? 'font-semibold text-amber-800' : 'text-ink-muted')}>
              {inChair ? p.label : `Called ${minutesSince(current.calledAt, now)} min ago — start when they sit down`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {inChair ? (
            <Button size="lg" variant="accent" className="h-14 flex-1 text-base sm:flex-none" onClick={() => h.finish(current)}>
              <Banknote /> Done + take payment
            </Button>
          ) : (
            <>
              <Button size="lg" className="h-14 flex-1 text-base sm:flex-none" loading={h.pending(current, 'start')} onClick={() => h.act(current, 'start')}>
                <Play /> Start the cut
              </Button>
              <Button size="lg" variant="outline" className="h-14" onClick={() => h.confirm(current, 'no_show')}>
                <UserX /> Didn’t come up
              </Button>
            </>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="mt-5 space-y-2">
      <Button
        size="lg"
        variant="accent"
        className="h-16 w-full justify-between rounded-xl px-5 text-lg shadow-raised"
        disabled={!next || h.pending(next, 'call')}
        loading={!!next && h.pending(next, 'call')}
        onClick={() => next && h.act(next, 'call')}
      >
        <span className="inline-flex items-center gap-2.5">
          <Megaphone className="!size-6" /> Call next customer
        </span>
        {next && <span className="font-display text-2xl tabular">#{next.number}</span>}
      </Button>
      <p className="text-[13px] text-cream/90">
        {next
          ? `Next for you: ${displayName(next.customerName)} · ${next.servicesSummary}${next.preferredStaffId === me.id ? ' · asked for you' : ''}`
          : board.waiting > 0
            ? 'Everyone waiting has asked for another barber.'
            : 'Nobody is waiting right now. Walk-ins who join will show up here.'}
      </p>
    </div>
  )
}

function FinishedList({ items }: { items: QueueTicketDto[] }) {
  const [open, setOpen] = useState(false)
  if (items.length === 0) return null
  return (
    <section aria-label="Finished today" className="rounded-2xl border border-line bg-surface shadow-card">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-14 w-full cursor-pointer items-center justify-between gap-3 px-4 text-left">
        <span className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="size-5 text-emerald-700" aria-hidden /> Finished today
          <Badge variant="neutral">{items.length}</Badge>
        </span>
        <ChevronDown className={cn('size-5 text-ink-muted transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <ul className="stagger divide-y divide-line border-t border-line">
          {items.map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-10 shrink-0 font-display text-lg font-bold text-ink-muted tabular">#{t.number}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{displayName(t.customerName)}</span>
                <span className="block truncate text-[12px] text-ink-muted">
                  {t.statusLabel}
                  {t.staffName ? ` · ${t.staffName}` : ''} · waited {t.waitedMinutes} min
                </span>
              </span>
              {t.bookingId && (
                <Link to={`/bookings/${t.bookingId}`} className="inline-flex min-h-11 shrink-0 items-center text-[13px] font-semibold text-forest-800 hover:underline">
                  Visit
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/**
 * /queue — today's walk-in queue. The front desk adds people and sends them to barbers; barbers call the next person,
 * start and finish (with the payment). Waits are estimates shared across the barbers working now, never promises.
 */
export function QueuePage() {
  const q = useQueueBoard()
  const ws = useWorkspace()
  const { can, experience } = useAccess()
  const { activeBusiness } = useBusiness()
  const desk = can('manageBookings')
  const services = useServices(false, desk)
  const act = useQueueAction()
  const now = useNow(20_000)
  const [adding, setAdding] = useState(false)
  const [sending, setSending] = useState<QueueTicketDto | null>(null)
  const [finishing, setFinishing] = useState<QueueTicketDto | null>(null)
  const [confirming, setConfirming] = useState<{ t: QueueTicketDto; action: 'left' | 'no_show' } | null>(null)

  const b = q.data
  const me = ws.data?.profile ?? null
  const team = useMemo(() => {
    const list = [...(ws.data?.team ?? [])]
    if (me && !list.some((x) => x.id === me.id)) list.unshift(me)
    return list
  }, [ws.data, me])
  const cols = useMemo(() => queueColumns(b?.open ?? []), [b])
  const canPay = can('recordSales', 'takeBookingPayments')
  const finishPrices = useMemo(() => {
    const who = team.find((x) => x.id === finishing?.staffId) ?? (finishing?.staffId === me?.id ? me : null)
    return who?.services ?? []
  }, [team, finishing, me])

  const h: Handlers = {
    desk,
    busy: !!me && (b?.open ?? []).some((x) => x.status === 'in_chair' && x.staffId === me.id),
    act: (t, action) =>
      act.mutate(
        { id: t.id, action },
        {
          onSuccess: () => {
            if (action === 'call') toast.success(`Calling #${t.number} ${displayName(t.customerName)}`, { description: 'Say their number out loud — they see it on their phone too if they joined by QR.' })
            else if (action === 'start') toast.success(`#${t.number} is in the chair`)
            else if (action === 'requeue') toast(`#${t.number} is back in the queue`)
          },
          onError: (e) => toast.error('That did not work', { description: errorMessage(e) }),
        },
      ),
    send: setSending,
    finish: setFinishing,
    confirm: (t, action) => setConfirming({ t, action }),
    pending: (t, action) => act.isPending && act.variables?.id === t.id && act.variables?.action === action,
  }

  const updated = q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null
  const showMyChair = !!me && me.isBookable && !!b

  return (
    <div className="space-y-7">
      <HeroPanel as="header">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <AppBadge experience={experience} who={me && !desk ? me.displayName : activeBusiness?.name} tone="dark" />
            <h1 className="mt-3 flex items-center gap-3 text-[1.9rem] leading-tight font-bold text-white sm:text-[2.4rem]">
              Walk-in queue
              <span className="pole-turn hidden h-8 w-3 rounded-full ring-2 ring-white/20 sm:inline-block" aria-hidden />
            </h1>
            <p className="mt-1 text-[15px] text-cream">
              {b ? formatDayLabel(b.date) : 'Today'}
              {updated && ` · live, updated ${formatTime(updated.toISOString())} (every ${Math.round(QUEUE_REFETCH_MS / 1000)} s)`}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {desk && (
              <Button variant="accent" size="lg" onClick={() => setAdding(true)} disabled={b ? !b.enabled : false}>
                <UserPlus /> Add walk-in
              </Button>
            )}
            <Button
              variant="outline"
              size="lg"
              className="border-white/25 bg-transparent text-white hover:bg-white/10 hover:text-white"
              loading={q.isFetching && !q.isLoading}
              onClick={() => q.refetch()}
              aria-label="Refresh the queue"
            >
              {!(q.isFetching && !q.isLoading) && <RefreshCw />} <span className="max-sm:sr-only">Refresh</span>
            </Button>
          </div>
        </div>
        {b ? (
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
            <HeroStat label="Waiting" icon={Users} value={<AnimatedNumber value={b.waiting} />} tone={b.waiting > 0 ? 'attention' : 'default'} hint="In line now" hideHintOnPhone />
            <HeroStat label="In the chair" icon={Armchair} value={<AnimatedNumber value={b.inChair} />} hint="Cuts in progress" hideHintOnPhone />
            <HeroStat label="Done today" icon={CheckCircle2} value={<AnimatedNumber value={b.doneToday} />} tone={b.doneToday > 0 ? 'good' : 'default'} hint="Walk-ins finished" hideHintOnPhone />
            <HeroStat label="Barbers in" icon={ListOrdered} value={<AnimatedNumber value={b.barbersWorking} />} hint="Available or busy now" hideHintOnPhone />
            <HeroStat label="Next wait" icon={Hourglass} value={<span className="block text-[1.05rem] leading-tight sm:text-[1.2rem]">{b.nextWaitLabel}</span>} hint="An estimate, not a promise" />
            <HeroStat
              label="Average wait"
              icon={Clock}
              value={b.averageWaitMinutes == null ? '—' : <AnimatedNumber value={b.averageWaitMinutes} format={(n) => `${Math.round(n)} min`} />}
              hint="From joining to the chair, today"
              hideHintOnPhone
            />
          </div>
        ) : q.isLoading ? (
          <div className="mt-5 grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6" aria-busy aria-label="Loading">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 [--skel-shine:rgb(255_255_255/0.08)] [--skel:rgb(255_255_255/0.07)]" />
            ))}
          </div>
        ) : null}
        {showMyChair && me && <MyChair board={b} me={me} h={h} now={now} />}
      </HeroPanel>

      {q.isLoading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-48" />
          <Skeleton className="h-72" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load the queue" />
      ) : b ? (
        <>
          {!b.enabled && (
            <Callout tone="warning" title="The walk-in queue is switched off">
              Customers cannot join from their phones and the desk cannot add walk-ins until it is switched on again in Settings.
            </Callout>
          )}
          {b.open.length === 0 ? (
            <EmptyState
              icon={ListOrdered}
              title="Nobody in the queue"
              description={
                desk
                  ? 'Add walk-ins as they come in, or let them join from your booking page QR code — they get a number and a live wait estimate on their phone.'
                  : 'When the desk adds a walk-in or a customer joins by QR code, they show up here.'
              }
              action={
                desk &&
                b.enabled && (
                  <Button onClick={() => setAdding(true)}>
                    <UserPlus /> Add walk-in
                  </Button>
                )
              }
            />
          ) : (
            <div className="grid min-w-0 gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] lg:items-start">
              <div className="min-w-0 space-y-7">
                <Section title="In the chair" icon={Armchair} count={cols.inChair.length}>
                  {cols.inChair.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-sm text-ink-muted">No cuts in progress.</p>
                  ) : (
                    <ul className="stagger grid gap-3">
                      {cols.inChair.map((t) => (
                        <ChairCard key={t.id} t={t} h={h} now={now} />
                      ))}
                    </ul>
                  )}
                </Section>
                {cols.called.length > 0 && (
                  <Section title="Called" icon={Megaphone} count={cols.called.length} hint="On their way to the chair">
                    <ul className="stagger grid gap-3">
                      {cols.called.map((t) => (
                        <WaitingRow key={t.id} t={t} h={h} now={now} />
                      ))}
                    </ul>
                  </Section>
                )}
              </div>
              <Section title="Waiting" icon={Users} count={cols.waiting.length} hint="Wait times are estimates">
                {cols.waiting.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-sm text-ink-muted">Nobody waiting. The next walk-in goes straight to a free barber.</p>
                ) : (
                  <ol className="stagger grid gap-3">
                    {cols.waiting.map((t) => (
                      <WaitingRow key={t.id} t={t} h={h} now={now} />
                    ))}
                  </ol>
                )}
              </Section>
            </div>
          )}
          <FinishedList items={b.finished} />
        </>
      ) : null}

      {desk && <AddWalkInDialog open={adding} onOpenChange={setAdding} services={services.data ?? []} team={team} />}
      {desk && <SendToBarberDialog ticket={sending} onOpenChange={(o) => !o && setSending(null)} team={team} />}
      <FinishDialog ticket={finishing} onOpenChange={(o) => !o && setFinishing(null)} prices={finishPrices} canPay={canPay} />
      <ConfirmDialog
        open={!!confirming}
        onOpenChange={(o) => !o && setConfirming(null)}
        title={confirming?.action === 'left' ? `Did #${confirming?.t.number} leave?` : `#${confirming?.t.number} didn’t come up?`}
        description={
          confirming?.action === 'left'
            ? `${displayName(confirming.t.customerName)} is taken out of the queue. Everyone behind them moves up.`
            : `${displayName(confirming?.t.customerName ?? '')} was called but did not come to the chair. They are taken out of the queue.`
        }
        confirmLabel={confirming?.action === 'left' ? 'Yes, they left' : 'Yes, take them off'}
        destructive
        pending={act.isPending}
        onConfirm={() => {
          if (!confirming) return
          const { t, action } = confirming
          act.mutate(
            { id: t.id, action },
            {
              onSuccess: () => {
                toast(`#${t.number} taken off the queue`)
                setConfirming(null)
              },
              onError: (e) => toast.error('That did not work', { description: errorMessage(e) }),
            },
          )
        }}
      />
    </div>
  )
}
