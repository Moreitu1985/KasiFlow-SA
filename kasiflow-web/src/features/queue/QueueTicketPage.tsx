import { useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Armchair, CheckCircle2, DoorOpen, Hourglass, LogIn, Megaphone, RefreshCw, SearchX, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { CopyButton } from '@/components/shared/CopyButton'
import { ErrorState } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatTime } from '@/lib/barbershop'
import { cn } from '@/lib/utils'
import { useAuth } from '@/features/auth/AuthProvider'
import { PublicShell } from '@/features/public-booking/PublicShell'
import type { PublicTicketDto } from '@/types/pro'
import { TICKET_REFETCH_MS, useLeaveQueue, usePublicTicket } from './api'

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

function Turn({ t }: { t: PublicTicketDto }) {
  if (t.status === 'called')
    return (
      <div role="status" aria-live="assertive" className="animate-turn-pulse rounded-2xl bg-emerald-brand p-5 text-center text-forest-950">
        <Megaphone className="mx-auto size-8" aria-hidden />
        <p className="mt-2 font-display text-3xl font-bold">It’s your turn!</p>
        <p className="mt-1 text-[16px] font-semibold">{t.staffName ? `Go to ${t.staffName}’s chair.` : 'Go to the front desk.'}</p>
      </div>
    )
  if (t.status === 'in_chair')
    return (
      <div className="rounded-2xl bg-tint p-5 text-center">
        <Armchair className="mx-auto size-8 text-ochre" aria-hidden />
        <p className="mt-2 font-display text-2xl font-bold">You’re in the chair</p>
        <p className="mt-1 text-ink-soft">{t.staffName ? `With ${t.staffName}. Enjoy the cut.` : 'Enjoy the cut.'}</p>
      </div>
    )
  if (t.status === 'done')
    return (
      <div className="rounded-2xl bg-emerald-50 p-5 text-center text-emerald-900">
        <CheckCircle2 className="mx-auto size-8" aria-hidden />
        <p className="mt-2 font-display text-2xl font-bold">All done — thanks for coming</p>
      </div>
    )
  if (t.status === 'left' || t.status === 'no_show')
    return (
      <div className="rounded-2xl bg-paper p-5 text-center">
        <DoorOpen className="mx-auto size-8 text-ink-muted" aria-hidden />
        <p className="mt-2 font-display text-2xl font-bold">{t.status === 'left' ? 'You left the queue' : 'Your number was passed'}</p>
        <p className="mt-1 text-ink-soft">You can join again from the shop’s page.</p>
      </div>
    )
  return (
    <dl className="grid grid-cols-2 gap-3">
      <div className="rounded-2xl bg-tint p-4">
        <dt className="flex items-center gap-1.5 text-[13px] font-medium text-ink-muted">
          <Users className="size-4" aria-hidden /> Your place
        </dt>
        <dd className="mt-1 font-display text-3xl font-bold text-heading">{t.position != null ? ordinal(t.position) : '—'}</dd>
        <dd className="text-[12px] text-ink-muted">in line</dd>
      </div>
      <div className="rounded-2xl bg-tint p-4">
        <dt className="flex items-center gap-1.5 text-[13px] font-medium text-ink-muted">
          <Hourglass className="size-4" aria-hidden /> Wait
        </dt>
        <dd className="mt-1 text-lg leading-tight font-bold text-heading">{t.waitLabel ?? '—'}</dd>
        <dd className="text-[12px] text-ink-muted">an estimate, not a promise</dd>
      </div>
    </dl>
  )
}

/**
 * /q/:id?t=… — the customer's queue ticket: a huge number, their place and a wait estimate, refreshed every 15
 * seconds, and a gentle "It's your turn!" when the barber calls them. Works from the private link without signing in.
 */
export function QueueTicketPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const token = params.get('t')
  const { session, loading } = useAuth()
  const q = usePublicTicket(id, token, !!session)
  const leave = useLeaveQueue(id)
  const [confirm, setConfirm] = useState(false)
  const t = q.data
  const prev = useRef<string | null>(null)

  useEffect(() => {
    document.title = t ? (t.status === 'called' ? `It’s your turn — #${t.number}` : `#${t.number} · ${t.businessName} queue`) : 'Your queue ticket | KasiFlow SA'
    if (t && prev.current && prev.current !== 'called' && t.status === 'called') {
      try {
        navigator.vibrate?.([200, 100, 200])
      } catch {
        /* not supported */
      }
    }
    prev.current = t?.status ?? null
  }, [t])

  const notFound = q.error instanceof ApiError && (q.error.status === 404 || q.error.status === 403)
  const needSignIn = !token && !session && !loading
  const open = t && (t.status === 'waiting' || t.status === 'called')
  const updated = q.dataUpdatedAt ? new Date(q.dataUpdatedAt) : null
  const link = typeof window !== 'undefined' ? window.location.href : ''

  return (
    <PublicShell back={{ to: '/c/shops', label: 'Find a barber' }}>
      {needSignIn ? (
        <div className="rounded-2xl border border-line bg-surface px-6 py-12 text-center shadow-card">
          <LogIn className="mx-auto mb-4 size-10 text-forest-800" aria-hidden />
          <h1 className="text-2xl font-bold">Open your ticket</h1>
          <p className="mx-auto mt-2 max-w-sm text-[15px] text-ink-soft">Use the full link you got when you joined, or sign in with the email you joined with.</p>
          <Button asChild className="mt-5">
            <Link to={`/c/sign-in?next=${encodeURIComponent(`/q/${id}`)}`}>Sign in</Link>
          </Button>
        </div>
      ) : notFound ? (
        <div className="rounded-2xl border border-line bg-surface px-6 py-12 text-center shadow-card">
          <SearchX className="mx-auto mb-4 size-10 text-forest-800" aria-hidden />
          <h1 className="text-2xl font-bold">Ticket not found</h1>
          <p className="mx-auto mt-2 max-w-sm text-[15px] text-ink-soft">Check that you opened the full link. Tickets are for today only.</p>
        </div>
      ) : q.isLoading || loading ? (
        <div className="space-y-4" aria-busy aria-label="Loading your ticket">
          <Skeleton className="h-72 rounded-3xl" />
          <Skeleton className="h-24" />
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load your ticket" />
      ) : t ? (
        <div className="animate-pop-in space-y-5">
          <article className="overflow-hidden rounded-3xl border border-line bg-surface shadow-raised" aria-labelledby="ticket-h">
            <div className="kasi-band h-3" aria-hidden />
            <div className="space-y-5 p-5 sm:p-7">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-forest-800">Walk-in queue</p>
                  <p className="truncate text-lg font-bold">{t.businessName}</p>
                </div>
                <Badge variant={t.status === 'called' ? 'warning' : t.status === 'done' ? 'success' : t.status === 'waiting' || t.status === 'in_chair' ? 'info' : 'neutral'} className="shrink-0 text-[13px]">
                  {t.statusLabel}
                </Badge>
              </div>
              <div className="text-center">
                <p className="text-[13px] font-semibold tracking-[0.2em] text-ink-muted uppercase">Your number</p>
                <h1
                  id="ticket-h"
                  className={cn('font-display text-[7.5rem] leading-[0.9] font-bold tracking-tight text-heading tabular sm:text-[9rem]', t.status === 'called' && 'text-ochre')}
                >
                  {t.number}
                </h1>
                <p className="mt-2 text-[15px] text-ink-soft">{t.servicesSummary}</p>
              </div>
              <Turn t={t} />
              <p className="text-center text-[15px] leading-relaxed">{t.message}</p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-paper/60 px-5 py-3 text-[12px] text-ink-muted">
              <span className="inline-flex items-center gap-1.5">
                <RefreshCw className={cn('size-3.5', q.isFetching && 'animate-spin')} aria-hidden />
                {updated ? `Updated ${formatTime(updated.toISOString())}` : 'Live'}
                {open ? ` · refreshes every ${TICKET_REFETCH_MS / 1000} s` : ''}
              </span>
              {token && <CopyButton text={link} label="Copy my ticket link" />}
            </div>
          </article>
          {open && token && (
            <div className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-ink-soft">Can’t wait any more? Leaving lets everyone behind you move up.</p>
              <Button variant="outline" onClick={() => setConfirm(true)}>
                <DoorOpen /> Leave the queue
              </Button>
            </div>
          )}
          <p className="text-center text-[12px] text-ink-muted">Keep this page open, or add it to your home screen. The shop sees your first name and number only.</p>
        </div>
      ) : null}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Leave the queue?"
        description="Your number is given up. You can join again later, at the back of the line."
        confirmLabel="Yes, leave"
        destructive
        pending={leave.isPending}
        onConfirm={() =>
          leave.mutate(token ?? '', {
            onSuccess: () => {
              setConfirm(false)
              toast('You left the queue')
            },
            onError: (e) => toast.error('Could not leave the queue', { description: errorMessage(e) }),
          })
        }
      />
    </PublicShell>
  )
}
