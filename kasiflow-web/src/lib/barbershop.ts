/**
 * Pure helpers for the barbershop platform: status labels, booking actions, time formatting in
 * Africa/Johannesburg, slot grouping and money-figure presentation. No React, no network.
 */
import type {
  AlertStatus,
  BankChangeSource,
  BankDetailStatus,
  BankVerifyMethod,
  BookingAction,
  BookingStatus,
  BookingSummaryDto,
  ChargeStatus,
  DebtStatus,
  MoneyFigureDto,
  ProofStatus,
  ReminderChannel,
  ReminderOutcome,
  SlotDto,
  StaffStatus,
  TimeOffKind,
  WorkingHoursDto,
} from '@/types/barbershop'

export type Tone = 'success' | 'info' | 'warning' | 'critical' | 'neutral' | 'forest' | 'outline'

// ---------- Staff status ----------
export const STAFF_STATUSES: StaffStatus[] = ['available', 'busy', 'house_call', 'on_break', 'unavailable', 'off_duty']

export const STAFF_STATUS_LABELS: Record<StaffStatus, string> = {
  available: 'Available',
  busy: 'Busy',
  house_call: 'On a house call',
  on_break: 'On break',
  unavailable: 'Unavailable',
  off_duty: 'Off duty',
}

export function staffStatusLabel(status: string | null | undefined): string {
  if (!status) return '—'
  return (STAFF_STATUS_LABELS as Record<string, string>)[status] ?? status
}

export function staffStatusTone(status: string): Tone {
  switch (status) {
    case 'available':
      return 'success'
    case 'busy':
    case 'house_call':
      return 'warning'
    case 'on_break':
      return 'info'
    case 'unavailable':
      return 'critical'
    default:
      return 'neutral'
  }
}

/** Statuses that usually last a short while, so the picker offers "for X minutes". */
export function isTemporaryStatus(status: StaffStatus): boolean {
  return status === 'busy' || status === 'house_call' || status === 'on_break' || status === 'unavailable'
}

export const STATUS_DURATIONS: { minutes: number; label: string }[] = [
  { minutes: 15, label: '15 min' },
  { minutes: 30, label: '30 min' },
  { minutes: 45, label: '45 min' },
  { minutes: 60, label: '1 hour' },
  { minutes: 90, label: '1½ hours' },
  { minutes: 120, label: '2 hours' },
]

// ---------- Bookings ----------
export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  reschedule_proposed: 'Reschedule proposed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
}

export function bookingStatusLabel(status: string): string {
  return (BOOKING_STATUS_LABELS as Record<string, string>)[status] ?? status
}

export function bookingStatusTone(status: string): Tone {
  switch (status) {
    case 'confirmed':
      return 'success'
    case 'requested':
      return 'info'
    case 'reschedule_proposed':
      return 'warning'
    case 'completed':
      return 'forest'
    case 'no_show':
      return 'critical'
    default:
      return 'neutral'
  }
}

export function locationLabel(type: string): string {
  return type === 'house_call' ? 'House call' : 'In the shop'
}

export interface ActionButton {
  action: BookingAction
  label: string
  variant: 'default' | 'outline' | 'destructive' | 'ghost' | 'accent'
}

const ACTION_META: Record<BookingAction, Omit<ActionButton, 'action'> & { order: number }> = {
  confirm: { label: 'Confirm', variant: 'default', order: 1 },
  accept_proposal: { label: 'Accept customer’s time', variant: 'default', order: 2 },
  complete: { label: 'Complete visit', variant: 'accent', order: 3 },
  reject_proposal: { label: 'Reject customer’s time', variant: 'outline', order: 4 },
  propose_reschedule: { label: 'Propose new time', variant: 'outline', order: 5 },
  no_show: { label: 'No-show', variant: 'outline', order: 6 },
  cancel: { label: 'Cancel booking', variant: 'ghost', order: 7 },
}

/** Buttons to show for a booking, from the API's `allowedActions`. Unknown actions are ignored; order is stable. */
export function bookingButtons(allowed: readonly string[] | null | undefined): ActionButton[] {
  if (!allowed) return []
  const seen = new Set<string>()
  return allowed
    .filter((a): a is BookingAction => a in ACTION_META && !seen.has(a) && !!seen.add(a))
    .sort((a, b) => ACTION_META[a].order - ACTION_META[b].order)
    .map((action) => ({ action, label: ACTION_META[action].label, variant: ACTION_META[action].variant }))
}

/**
 * Quick actions for a booking list row (lists carry no `allowedActions`). Mirrors the API's state machine; the API
 * still decides. Completion and no-show are only offered once the appointment has started.
 */
export function quickActions(b: Pick<BookingSummaryDto, 'status' | 'startsAt' | 'proposedBy'>, nowMs: number): BookingAction[] {
  const started = new Date(b.startsAt).getTime() <= nowMs
  switch (b.status) {
    case 'requested':
      return ['confirm', 'propose_reschedule']
    case 'confirmed':
      return started ? ['complete', 'no_show'] : ['propose_reschedule']
    case 'reschedule_proposed':
      return b.proposedBy === 'customer' ? ['accept_proposal', 'reject_proposal'] : []
    default:
      return []
  }
}

/** The 409 detail from confirm says the owner can approve an exception; only owner/admin roles may tick it. */
export function canOfferException(role: string, detail: string | undefined, policyAllows: boolean | undefined): boolean {
  if (!detail) return false
  if (role !== 'owner' && role !== 'business_admin') return false
  if (policyAllows === false) return false
  return /exception/i.test(detail)
}

export function eventLabel(event: string): string {
  const map: Record<string, string> = {
    requested: 'Requested',
    created: 'Created',
    confirmed: 'Confirmed',
    reschedule_proposed: 'New time proposed',
    reschedule_requested: 'Customer asked for another time',
    proposal_accepted: 'Proposal accepted',
    proposal_rejected: 'Proposal rejected',
    proposal_declined: 'Proposal declined',
    completed: 'Completed',
    no_show: 'Marked as no-show',
    cancelled: 'Cancelled',
    house_call_updated: 'House-call details updated',
    expense_added: 'Trip expense added',
  }
  return map[event] ?? humanizeKey(event)
}

function humanizeKey(v: string): string {
  const s = v.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

// ---------- Time (Africa/Johannesburg, UTC+2 all year) ----------
const JHB = 'Africa/Johannesburg'
const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-17T07:30:00+00:00" -> "09:30" (Johannesburg). */
export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat('en-GB', { timeZone: JHB, hour: '2-digit', minute: '2-digit', hour12: false }).format(d)
}

/** Johannesburg calendar date of an instant, as YYYY-MM-DD. */
export function jhbDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return new Intl.DateTimeFormat('en-CA', { timeZone: JHB, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** "2026-10-17" -> "Sat 17 Oct" */
export function formatDayLabel(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return ymd
  const wd = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay()
  return `${WEEKDAY_SHORT[wd]} ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`
}

/** "Sat 17 Oct, 09:30" */
export function formatWhen(iso: string | null | undefined): string {
  if (!iso) return '—'
  return `${formatDayLabel(jhbDate(iso))}, ${formatTime(iso)}`
}

export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)}–${formatTime(end)}`
}

/** Johannesburg wall-clock date + time -> ISO with the +02:00 offset the API expects. */
export function jhbIso(ymd: string, hhmm: string): string {
  return `${ymd}T${hhmm.length === 5 ? hhmm : hhmm.slice(0, 5)}:00+02:00`
}

/** Weekday (0 = Sunday) of a YYYY-MM-DD date. */
export function weekdayOf(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function durationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes <= 0) return '—'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** Groups booking items by person label, keeping first-seen order. */
export function groupByPerson<T extends { personLabel: string }>(items: readonly T[]): { person: string; items: T[] }[] {
  const out: { person: string; items: T[] }[] = []
  for (const it of items) {
    const g = out.find((x) => x.person === it.personLabel)
    if (g) g.items.push(it)
    else out.push({ person: it.personLabel, items: [it] })
  }
  return out
}

// ---------- Slots ----------
export interface SlotGroup {
  startsAt: string
  time: string
  period: 'Morning' | 'Afternoon' | 'Evening'
  staff: { staffId: string; staffName: string; endsAt: string }[]
}

export function slotPeriod(time: string): SlotGroup['period'] {
  const h = Number(time.slice(0, 2))
  if (h < 12) return 'Morning'
  if (h < 17) return 'Afternoon'
  return 'Evening'
}

/**
 * The API returns one slot per barber per start time. Group them by start time (sorted), optionally only for one
 * barber, so the picker shows each time once with the barbers who are free.
 */
export function groupSlots(slots: readonly SlotDto[], staffId?: string | null): SlotGroup[] {
  const byStart = new Map<number, SlotGroup>()
  for (const s of slots) {
    if (staffId && s.staffId !== staffId) continue
    const t = new Date(s.startsAt).getTime()
    if (Number.isNaN(t)) continue
    let g = byStart.get(t)
    if (!g) {
      const time = formatTime(s.startsAt)
      g = { startsAt: s.startsAt, time, period: slotPeriod(time), staff: [] }
      byStart.set(t, g)
    }
    if (!g.staff.some((x) => x.staffId === s.staffId)) g.staff.push({ staffId: s.staffId, staffName: s.staffName, endsAt: s.endsAt })
  }
  return [...byStart.entries()].sort((a, b) => a[0] - b[0]).map(([, g]) => g)
}

/** Slot groups bucketed into Morning / Afternoon / Evening (empty buckets dropped). */
export function slotsByPeriod(groups: readonly SlotGroup[]): { period: SlotGroup['period']; slots: SlotGroup[] }[] {
  const order: SlotGroup['period'][] = ['Morning', 'Afternoon', 'Evening']
  return order.map((period) => ({ period, slots: groups.filter((g) => g.period === period) })).filter((x) => x.slots.length > 0)
}

// ---------- Working hours ----------
export function hoursForDay(hours: readonly WorkingHoursDto[], weekday: number): WorkingHoursDto[] {
  return hours.filter((h) => h.weekday === weekday).sort((a, b) => a.start.localeCompare(b.start))
}

/** Client-side check before saving: start before end, no overlapping blocks on a day, at most 3 blocks a day. */
export function validateHours(hours: readonly WorkingHoursDto[]): string | null {
  for (let d = 0; d < 7; d++) {
    const day = hoursForDay(hours, d)
    if (day.length > 3) return `${WEEKDAY_NAMES[d]}: use at most 3 time blocks.`
    for (let i = 0; i < day.length; i++) {
      if (!/^\d{2}:\d{2}$/.test(day[i].start) || !/^\d{2}:\d{2}$/.test(day[i].end)) return `${WEEKDAY_NAMES[d]}: enter times like 08:00.`
      if (day[i].end <= day[i].start) return `${WEEKDAY_NAMES[d]}: each block must start before it ends.`
      if (i > 0 && day[i].start < day[i - 1].end) return `${WEEKDAY_NAMES[d]}: time blocks must not overlap.`
    }
  }
  return null
}

export const TIME_OFF_KINDS: Record<TimeOffKind, string> = {
  class: 'Class',
  exam: 'Exam',
  leave: 'Leave',
  personal: 'Personal',
  other: 'Other',
}

// ---------- Debts ----------
export const DEBT_STATUS_LABELS: Record<DebtStatus, string> = {
  outstanding: 'Outstanding',
  partially_paid: 'Partially paid',
  overdue: 'Overdue',
  settled: 'Settled',
  disputed: 'Disputed',
  written_off: 'Written off',
}

export function debtStatusTone(status: string): Tone {
  switch (status) {
    case 'overdue':
      return 'critical'
    case 'disputed':
      return 'warning'
    case 'partially_paid':
      return 'info'
    case 'settled':
      return 'success'
    case 'written_off':
      return 'neutral'
    default:
      return 'outline'
  }
}

export const CHARGE_STATUS_LABELS: Record<ChargeStatus, string> = {
  proposed: 'Proposed — not added',
  applied: 'Applied',
  waived: 'Waived',
  reversed: 'Reversed',
}

/** Statement rows for proposed charges never change the balance and must be visibly marked. */
export function isNotAddedLine(kind: string): boolean {
  return kind === 'charge_proposed' || kind === 'charge_waived' || kind === 'charge_reversed'
}

export const REMINDER_CHANNELS: Record<ReminderChannel, string> = {
  whatsapp: 'WhatsApp',
  sms: 'SMS',
  call: 'Phone call',
  in_person: 'In person',
  manual: 'Other / manual',
}

export const REMINDER_OUTCOMES: Record<ReminderOutcome, string> = {
  sent: 'Reminder sent',
  promised: 'Promised to pay',
  no_answer: 'No answer',
  refused: 'Refused to pay',
}

/** 409 from the payment endpoints when the same amount was recorded minutes ago. */
export function isDuplicatePaymentConflict(status: number, detail: string | undefined): boolean {
  return status === 409 && !!detail && /separate payment|same payment/i.test(detail)
}

// ---------- Money summary ----------
/** Figures the panel shows first, in this order; any new keys from the API follow. */
const FIGURE_ORDER = ['sales', 'received', 'unpaid', 'expenses', 'contribution', 'pending', 'receivables', 'bills']

export function orderFigures(figures: readonly MoneyFigureDto[]): MoneyFigureDto[] {
  const rank = (k: string) => {
    const i = FIGURE_ORDER.indexOf(k)
    return i === -1 ? FIGURE_ORDER.length : i
  }
  return [...figures].sort((a, b) => rank(a.key) - rank(b.key))
}

export function figureTone(f: Pick<MoneyFigureDto, 'key' | 'amountCents'>): 'default' | 'warning' | 'critical' | 'positive' {
  if (f.key === 'contribution') return f.amountCents < 0 ? 'critical' : 'positive'
  if ((f.key === 'unpaid' || f.key === 'pending' || f.key === 'bills') && f.amountCents > 0) return 'warning'
  return 'default'
}

export const MONEY_PERIOD_LABELS = { day: 'Today', week: 'This week', month: 'This month' } as const

// ---------- Alerts ----------
export const ALERT_STATUS_LABELS: Record<AlertStatus, string> = {
  open: 'Open',
  under_review: 'Under review',
  resolved: 'Resolved',
  false_positive: 'False positive',
}

/** In-app link for an alert's evidence item, when the record type has a page. */
export function evidenceLink(sourceType: string, sourceId: string | null | undefined): string | null {
  if (!sourceId) return null
  switch (sourceType) {
    case 'transaction':
      return `/transactions/${sourceId}`
    case 'receivable':
      return `/debts/${sourceId}`
    case 'payable':
      return `/suppliers/bills/${sourceId}`
    case 'booking':
      return `/bookings/${sourceId}`
    case 'shift':
      return '/shifts'
    case 'product':
    case 'stock_movement':
      return '/inventory'
    case 'payment_proof':
      return '/payments'
    case 'supplier_bank_details':
    case 'supplier':
      return '/suppliers?tab=suppliers'
    default:
      return null
  }
}

// ---------- Payment proofs ----------
export function proofTone(status: ProofStatus | string): Tone {
  switch (status) {
    case 'confirmed_in_bank':
    case 'verified_by_provider':
      return 'success'
    case 'rejected':
      return 'critical'
    default:
      return 'warning'
  }
}

// ---------- Supplier bank details ----------
export const BANK_STATUS_LABELS: Record<BankDetailStatus, string> = {
  unverified: 'Not verified — do not pay',
  verified: 'Verified',
  rejected: 'Rejected',
  superseded: 'Replaced',
}

export const BANK_SOURCES: Record<BankChangeSource, string> = {
  owner_entry: 'I entered them from my own records',
  supplier_message: 'Supplier sent a message / email',
  invoice: 'Printed on an invoice',
  other: 'Other',
}

export const BANK_VERIFY_METHODS: Record<BankVerifyMethod, string> = {
  called_known_number: 'Phoned the supplier on a number I already had',
  in_person: 'Confirmed in person',
  bank_confirmation_letter: 'Bank confirmation letter',
  other: 'Other',
}

/** Account numbers are sent once and only the last 4 digits are kept. */
export function accountDigits(input: string): string {
  return input.replace(/\D/g, '')
}

// ---------- Public booking ----------
/** Total for the chosen services (sum of prices × people). Travel fee is shown separately as policy text. */
export function servicesTotal(
  people: readonly { serviceIds: readonly string[] }[],
  services: readonly { id: string; priceCents: number; durationMinutes: number }[],
): { totalCents: number; durationMinutes: number; count: number } {
  let totalCents = 0
  let durationMinutes = 0
  let count = 0
  for (const p of people)
    for (const id of p.serviceIds) {
      const s = services.find((x) => x.id === id)
      if (!s) continue
      totalCents += s.priceCents
      durationMinutes += s.durationMinutes
      count++
    }
  return { totalCents, durationMinutes, count }
}

/** Builds the booking items list with person labels ("Person 1", "Person 2") when more than one person is booked. */
export function itemsFromPeople(people: readonly { label?: string; serviceIds: readonly string[] }[]): { serviceId: string; personLabel: string | null }[] {
  const multi = people.filter((p) => p.serviceIds.length > 0).length > 1
  return people.flatMap((p, i) =>
    p.serviceIds.map((serviceId) => ({ serviceId, personLabel: multi ? (p.label?.trim() || `Person ${i + 1}`) : (p.label?.trim() || null) })),
  )
}

/**
 * The public status DTO lists services as "Person 1: Haircut" text, not ids. To look up free times for "request
 * another time", map those names back to the business's public services (best effort: names must still match).
 */
export function serviceIdsFromLabels(labels: readonly string[], services: readonly { id: string; name: string }[]): string[] {
  const out: string[] = []
  for (const l of labels) {
    const name = l.includes(': ') ? l.slice(l.indexOf(': ') + 2) : l
    const s = services.find((x) => x.name === name)
    if (s) out.push(s.id)
  }
  return out
}
