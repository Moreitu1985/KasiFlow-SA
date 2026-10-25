/**
 * Pure helpers for customer accounts, the public catalogue, barber registration and house-call safety.
 * No React, no network.
 */
import type { CustomerAccountDto, CustomerBookingDto, SafetyCheckinKind, SafetyNoteCategory } from '@/types/customer'
import type { WorkingHoursDto } from '@/types/barbershop'

// ---------- Navigation ----------
/** Only same-site paths ("/c", "/p/x/book?…"); anything else falls back. */
export function safeNext(next: string | null | undefined, fallback: string): string {
  if (next && next.startsWith('/') && !next.startsWith('//') && !next.startsWith('/\\')) return next
  return fallback
}

/** Pulls the invitation token out of a pasted link (or a bare token). */
export function inviteTokenFrom(input: string): string | null {
  const v = input.trim()
  if (!v) return null
  const m = /[?&]token=([^&#\s]+)/.exec(v)
  if (m) return decodeURIComponent(m[1])
  return /^[A-Za-z0-9_-]{16,}$/.test(v) ? v : null
}

// ---------- One-time code ----------
export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim())
}

/** Supabase OTP codes are 6 digits. Spaces and dashes typed by the person are ignored. */
export function cleanOtp(value: string): string {
  return value.replace(/[\s-]/g, '')
}

export function isValidOtp(value: string): boolean {
  return /^\d{6}$/.test(cleanOtp(value))
}

/** E.164 for South African numbers typed locally (082 123 4567 → +27821234567). Returns null when it cannot be a phone number. */
export function toE164(value: string): string | null {
  const digits = value.replace(/[^\d+]/g, '')
  if (/^\+\d{8,15}$/.test(digits)) return digits
  if (/^0\d{9}$/.test(digits)) return `+27${digits.slice(1)}`
  if (/^27\d{9}$/.test(digits)) return `+${digits}`
  return null
}

/** Friendly wording for Supabase auth errors. Rate limits keep Supabase's own message (it says how long to wait). */
export function otpErrorMessage(message: string | undefined, status?: number): string {
  const m = message ?? ''
  if (status === 429 || /rate limit|too many|security purposes|only request this/i.test(m))
    return m ? `Too many codes requested. ${m}` : 'Too many codes requested. Wait a minute and try again.'
  if (/expired|invalid|otp|token/i.test(m)) return 'That code is wrong or has expired. Check the latest email, or send a new code.'
  if (/signups? not allowed|disabled/i.test(m)) return 'Sign-in with a code is switched off for this site. Contact the business.'
  if (/sms|phone provider/i.test(m)) return 'Codes by SMS are not available right now. Use your email instead.'
  return m || 'Could not complete sign-in. Try again.'
}

// ---------- Customer account ----------
export interface AccountForm {
  fullName: string
  contactPhone: string
  addressLine: string
  suburb: string
  town: string
  accessNotes: string
}

export function accountForm(a: CustomerAccountDto | null | undefined): AccountForm {
  return {
    fullName: a?.fullName ?? '',
    contactPhone: a?.contactPhone ?? '',
    addressLine: a?.addressLine ?? '',
    suburb: a?.suburb ?? '',
    town: a?.town ?? '',
    accessNotes: a?.accessNotes ?? '',
  }
}

/** Trimmed values; empty strings become null so the API clears the field. */
export function accountInput(f: AccountForm): Record<keyof AccountForm, string | null> {
  const t = (v: string) => (v.trim() ? v.trim() : null)
  return {
    fullName: t(f.fullName),
    contactPhone: t(f.contactPhone),
    addressLine: t(f.addressLine),
    suburb: t(f.suburb),
    town: t(f.town),
    accessNotes: t(f.accessNotes),
  }
}

/** One-line address for display. */
export function addressLine(a: { addressLine?: string | null; suburb?: string | null; town?: string | null }): string {
  return [a.addressLine, a.suburb, a.town].map((x) => x?.trim()).filter(Boolean).join(', ')
}

/** Bookings split into upcoming (soonest first) and past (latest first). Cancelled and finished visits count as past. */
export function splitCustomerBookings(list: readonly CustomerBookingDto[], nowMs: number): { upcoming: CustomerBookingDto[]; past: CustomerBookingDto[] } {
  const closed = new Set(['completed', 'cancelled', 'no_show'])
  const upcoming: CustomerBookingDto[] = []
  const past: CustomerBookingDto[] = []
  for (const b of list) {
    if (!closed.has(b.status) && new Date(b.endsAt).getTime() >= nowMs) upcoming.push(b)
    else past.push(b)
  }
  upcoming.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  past.sort((a, b) => b.startsAt.localeCompare(a.startsAt))
  return { upcoming, past }
}

// ---------- Public catalogue ----------
export interface CatalogueGroup<T> {
  category: string
  items: T[]
}

/** Groups services by category in the order categories first appear; services without a category go last under "Other". */
export function groupCatalogue<T extends { category: string | null }>(services: readonly T[]): CatalogueGroup<T>[] {
  const groups: CatalogueGroup<T>[] = []
  const other: T[] = []
  for (const s of services) {
    const c = s.category?.trim()
    if (!c) {
      other.push(s)
      continue
    }
    const g = groups.find((x) => x.category.toLowerCase() === c.toLowerCase())
    if (g) g.items.push(s)
    else groups.push({ category: c, items: [s] })
  }
  if (other.length) groups.push({ category: groups.length ? 'Other' : 'Services', items: other })
  return groups
}

/** A barber's prices that differ from the list price (only those are worth showing on the barber's card). */
export function priceDifferences(
  prices: readonly { serviceId: string; priceCents: number }[] | null | undefined,
  services: readonly { id: string; name: string; priceCents: number }[],
): { serviceId: string; name: string; priceCents: number; listPriceCents: number }[] {
  const out: { serviceId: string; name: string; priceCents: number; listPriceCents: number }[] = []
  for (const p of prices ?? []) {
    const s = services.find((x) => x.id === p.serviceId)
    if (s && s.priceCents !== p.priceCents) out.push({ serviceId: s.id, name: s.name, priceCents: p.priceCents, listPriceCents: s.priceCents })
  }
  return out
}

/** Total using each barber's own price when a specific barber is chosen (list price otherwise). */
export function priceFor(serviceId: string, listPriceCents: number, prices: readonly { serviceId: string; priceCents: number }[] | null | undefined): number {
  return prices?.find((p) => p.serviceId === serviceId)?.priceCents ?? listPriceCents
}

// ---------- Barber registration ----------
/** Default weekly hours for a new barber: Monday to Saturday, 08:00–18:00. */
export function defaultBarberHours(): WorkingHoursDto[] {
  return [1, 2, 3, 4, 5, 6].map((weekday) => ({ weekday, start: '08:00', end: '18:00' }))
}

/** Absolute invite link for sharing (the API returns a path like /join?token=…). */
export function inviteUrl(origin: string, invitePath: string): string {
  const path = invitePath.startsWith('/') ? invitePath : `/${invitePath}`
  return `${origin.replace(/\/+$/, '')}${path}`
}

/** wa.me share link: WhatsApp lets the sender pick the chat. Nothing is sent automatically. */
export function whatsappShareUrl(message: string, link: string): string {
  const text = message.trim() ? `${message.trim()}\n\n${link}` : link
  return `https://wa.me/?text=${encodeURIComponent(text)}`
}

export function inviteMessageFor(name: string, businessName: string | null | undefined): string {
  const where = businessName ? ` at ${businessName}` : ''
  return `Hi ${name.trim() || 'there'}, here is your KasiFlow login link for your barber profile${where}. Open it, sign up or sign in with this email address, and you will see your bookings and workspace.`
}

// ---------- House-call safety ----------
export const SAFETY_ACTION_LABELS: Record<SafetyCheckinKind, string> = {
  departed: 'Left for the visit',
  arrived: 'Arrived',
  finished: 'Finished',
  returned: 'Back safely',
  help: 'I need help',
  all_clear: 'All clear',
}

export function safetyActionLabel(kind: string): string {
  return (SAFETY_ACTION_LABELS as Record<string, string>)[kind] ?? kind
}

const STAGE_ORDER: SafetyCheckinKind[] = ['departed', 'arrived', 'finished', 'returned']

/** Step check-ins the API allows next, in journey order (help and all-clear are separate buttons). */
export function stageActions(nextActions: readonly string[]): SafetyCheckinKind[] {
  return STAGE_ORDER.filter((k) => nextActions.includes(k))
}

/** Progress through the four steps, for a simple stepper (0–4). */
export function stageProgress(stage: string): number {
  const i = STAGE_ORDER.indexOf(stage as SafetyCheckinKind)
  return i < 0 ? 0 : i + 1
}

export const SAFETY_NOTE_CATEGORIES: Record<SafetyNoteCategory, string> = {
  access: 'Access / finding the place',
  pets: 'Pets',
  conduct: 'Conduct during the visit',
  safety_concern: 'Safety concern',
  other: 'Other',
}

export function safetyNoteCategoryLabel(category: string): string {
  return (SAFETY_NOTE_CATEGORIES as Record<string, string>)[category] ?? category
}

/** Alert rule codes about barber safety (shown as "Safety", not fraud). */
export const SAFETY_ALERT_CODES = ['HOUSE_CALL_HELP', 'HOUSE_CALL_OVERDUE'] as const

export function isSafetyAlert(ruleCode: string | null | undefined): boolean {
  return !!ruleCode && (SAFETY_ALERT_CODES as readonly string[]).includes(ruleCode)
}

/** Booking ids are GUIDs. Used to link safety alerts to /bookings/{id}. */
export function safetyAlertLink(ruleCode: string, affectedType: string | null, affectedId: string | null): string | null {
  if (!isSafetyAlert(ruleCode) || !affectedId) return null
  if (affectedType && affectedType !== 'booking') return null
  return `/bookings/${affectedId}`
}

/** Today's house calls for this barber that still need check-ins (confirmed or waiting). */
export function houseCallsNeedingSafety<T extends { locationType: string; status: string; staffId: string | null }>(today: readonly T[], staffId: string): T[] {
  return today.filter((b) => b.locationType === 'house_call' && b.staffId === staffId && (b.status === 'confirmed' || b.status === 'completed'))
}

/** The next customer: the first not-finished booking today whose end is still ahead. */
export function nextCustomer<T extends { status: string; startsAt: string; endsAt: string }>(today: readonly T[], nowMs: number): T | null {
  const open = today
    .filter((b) => (b.status === 'confirmed' || b.status === 'requested' || b.status === 'reschedule_proposed') && new Date(b.endsAt).getTime() > nowMs)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  return open[0] ?? null
}

// ---------- Portfolio ----------
export const PORTFOLIO_MAX_BYTES = 3 * 1024 * 1024
export const PORTFOLIO_TYPES = ['image/jpeg', 'image/png', 'image/webp']

export function checkPortfolioFile(file: { type: string; size: number } | null): string | null {
  if (!file) return 'Choose a photo.'
  if (!PORTFOLIO_TYPES.includes(file.type)) return 'Use a JPEG, PNG or WebP photo.'
  if (file.size > PORTFOLIO_MAX_BYTES) return 'The photo is larger than 3 MB. Use a smaller one.'
  return null
}
