/** Pure helpers for the walk-in queue (kept here so they can be unit-tested). Wait times are estimates, never promises. */
import type { QueueTicketDto } from '@/types/pro'

const byPlace = (a: QueueTicketDto, b: QueueTicketDto) => (a.position ?? 9999) - (b.position ?? 9999) || a.number - b.number

/** Waiting tickets in queue order. */
export function waitingInOrder(open: readonly QueueTicketDto[]): QueueTicketDto[] {
  return open.filter((t) => t.status === 'waiting').sort(byPlace)
}

/**
 * The ticket a barber should call next: the first person waiting who asked for this barber or for anyone, and whom
 * this person is allowed to call. Customers who asked for a colleague are left for that colleague.
 */
export function nextTicketFor(open: readonly QueueTicketDto[], staffId: string | null | undefined): QueueTicketDto | null {
  if (!staffId) return null
  return waitingInOrder(open).find((t) => t.allowedActions.includes('call') && (t.preferredStaffId === null || t.preferredStaffId === staffId)) ?? null
}

/** This barber's own customer: in the chair first, otherwise one they called. */
export function currentTicketFor(open: readonly QueueTicketDto[], staffId: string | null | undefined): QueueTicketDto | null {
  if (!staffId) return null
  const mine = open.filter((t) => t.staffId === staffId)
  return mine.find((t) => t.status === 'in_chair') ?? mine.find((t) => t.status === 'called') ?? null
}

export interface QueueColumns {
  inChair: QueueTicketDto[]
  called: QueueTicketDto[]
  waiting: QueueTicketDto[]
}

export function queueColumns(open: readonly QueueTicketDto[]): QueueColumns {
  const by = (s: QueueTicketDto['status']) => open.filter((t) => t.status === s)
  return {
    inChair: by('in_chair').sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? '')),
    called: by('called').sort((a, b) => (a.calledAt ?? '').localeCompare(b.calledAt ?? '')),
    waiting: waitingInOrder(open),
  }
}

/** Whole minutes since an ISO time (never negative). */
export function minutesSince(iso: string | null | undefined, nowMs: number): number {
  if (!iso) return 0
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.floor((nowMs - t) / 60_000))
}

/** How far a cut is against its estimate: a 0–100 bar plus whether it runs over. */
export function chairProgress(elapsedMinutes: number, estMinutes: number): { percent: number; over: boolean; label: string } {
  const est = Math.max(1, estMinutes)
  const over = elapsedMinutes > est
  return {
    percent: Math.min(100, Math.round((elapsedMinutes / est) * 100)),
    over,
    label: over ? `${elapsedMinutes} min · ${elapsedMinutes - est} min over the estimate` : `${elapsedMinutes} of about ${est} min`,
  }
}

/**
 * Prefills the payment for a finished walk-in from the barber's own prices, by matching the service names in the
 * ticket's summary. Returns null when any service is unknown (e.g. "Haircut (to be confirmed)"), so nobody is
 * charged a guessed amount.
 */
export function priceFromSummary(summary: string, prices: readonly { serviceName: string; priceCents: number }[]): number | null {
  const names = summary
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  if (names.length === 0) return null
  let total = 0
  for (const n of names) {
    const p = prices.find((x) => x.serviceName.trim().toLowerCase() === n)
    if (!p) return null
    total += p.priceCents
  }
  return total
}

/** The URL segment for an action ("no_show" → "no-show"). */
export function actionPath(action: string): string {
  return action.replace(/_/g, '-')
}

/**
 * Tidies a shortened name for display: "Thabo (." (a short form of "Thabo N. (fictional)") becomes "Thabo".
 * Never invents anything, only drops a dangling bracket.
 */
export function displayName(name: string): string {
  return name.replace(/\s*\(\.?\s*$/, '').trim() || name
}
