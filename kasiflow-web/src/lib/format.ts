/**
 * Formatting helpers. Money is always integer cents (ZAR). Dates are YYYY-MM-DD strings.
 * Formatting is deterministic and does not depend on the browser's locale data.
 */

function groupThousands(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 150000 -> "R1,500.00"; -25000 -> "-R250.00" */
export function formatZAR(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return '—'
  const value = Math.round(cents)
  const negative = value < 0
  const abs = Math.abs(value)
  const rands = Math.floor(abs / 100)
  const rem = abs % 100
  const text = `R${groupThousands(String(rands))}.${String(rem).padStart(2, '0')}`
  return negative ? `-${text}` : text
}

/** Compact variant for chart axes: R1.5k, R12k, R1.2m. */
export function formatZARCompact(cents: number): string {
  const rands = cents / 100
  const abs = Math.abs(rands)
  const sign = rands < 0 ? '-' : ''
  if (abs >= 1_000_000) return `${sign}R${trimZero((abs / 1_000_000).toFixed(1))}m`
  if (abs >= 1_000) return `${sign}R${trimZero((abs / 1_000).toFixed(1))}k`
  return `${sign}R${Math.round(abs)}`
}

function trimZero(s: string): string {
  return s.endsWith('.0') ? s.slice(0, -2) : s
}

/** Cents -> plain rand string suitable for an input field ("1500.50"). */
export function centsToRandInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return ''
  const negative = cents < 0
  const abs = Math.abs(Math.round(cents))
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`
  return negative ? `-${text}` : text
}

/**
 * Parse a rand amount typed by a user into integer cents using string parsing only
 * (no float multiplication). Accepts "1500", "1500.5", "1 500,50", "R1,500.50".
 * Returns null when the input is not a valid amount.
 */
export function parseRandToCents(input: string, opts: { allowNegative?: boolean } = {}): number | null {
  let s = input.trim().replace(/\s/g, '').replace(/^R/i, '')
  let negative = false
  if (s.startsWith('-')) {
    negative = true
    s = s.slice(1).replace(/^R/i, '')
  }
  if (s === '') return null
  // A single comma followed by 1-2 digits at the end is a decimal comma ("1500,50").
  if (/^\d+,\d{1,2}$/.test(s)) s = s.replace(',', '.')
  else s = s.replace(/,/g, '')
  const match = /^(\d+)(?:\.(\d{0,2}))?$/.exec(s)
  if (!match) return null
  const whole = match[1].replace(/^0+(?=\d)/, '')
  if (whole.length > 13) return null
  const frac = (match[2] ?? '').padEnd(2, '0')
  const cents = Number.parseInt(whole, 10) * 100 + Number.parseInt(frac, 10)
  if (!Number.isSafeInteger(cents)) return null
  if (negative) {
    if (!opts.allowNegative) return null
    return cents === 0 ? 0 : -cents
  }
  return cents
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "2026-10-16" -> "16 Oct 2026". Also accepts ISO timestamps (uses Johannesburg date). */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const ymd = value.length > 10 ? isoToJhbDate(value) : value
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd)
  if (!m) return value
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`
}

/** "2026-10-16" -> "16 Oct" */
export function formatShortDate(value: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m) return value
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Africa/Johannesburg',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(d)
  return `${formatDate(isoToJhbDate(iso))}, ${time}`
}

function isoToJhbDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return toJhbYmd(d)
}

function toJhbYmd(d: Date): string {
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
}

/** Today's date in Africa/Johannesburg as YYYY-MM-DD. */
export function todayJhb(): string {
  return toJhbYmd(new Date())
}

/** Add days to a YYYY-MM-DD date (calendar arithmetic in UTC, no timezone drift). */
export function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const date = new Date(Date.UTC(y, m - 1, d + days))
  return date.toISOString().slice(0, 10)
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—'
  return `${Math.round(value)}%`
}

/** snake_case enum -> "Sentence case" */
export function humanize(value: string | null | undefined): string {
  if (!value) return '—'
  const s = value.replace(/_/g, ' ')
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

/** Short price for headlines: "R40" for whole rands, "R42.50" otherwise (same thousands grouping as formatZAR). */
export function formatRandShort(cents: number | null | undefined): string {
  const full = formatZAR(cents)
  return full.endsWith('.00') ? full.slice(0, -3) : full
}
