/** Pure helpers for barber pay statements: periods and honest wording. A statement is to agree on, not a payslip. */
import type { EarningsDto } from '@/types/pro'
import { addDays, formatZAR } from './format'
import { firstOfMonth } from './periods'

export type PayPeriodKey = 'this_week' | 'last_week' | 'this_month' | 'last_30'

export const PAY_PERIODS: { key: PayPeriodKey; label: string }[] = [
  { key: 'this_week', label: 'This week' },
  { key: 'last_week', label: 'Last week' },
  { key: 'this_month', label: 'This month' },
  { key: 'last_30', label: 'Last 30 days' },
]

/** Monday of the week that contains `ymd` (weeks run Monday to Sunday). */
export function mondayOf(ymd: string): string {
  const [y, m, d] = ymd.split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay() // 0 = Sunday
  return addDays(ymd, -((dow + 6) % 7))
}

/** The from/to dates of a pay period, relative to today (Johannesburg date). */
export function payPeriodRange(key: PayPeriodKey, today: string): { from: string; to: string } {
  switch (key) {
    case 'this_week':
      return { from: mondayOf(today), to: today }
    case 'last_week': {
      const mon = addDays(mondayOf(today), -7)
      return { from: mon, to: addDays(mon, 6) }
    }
    case 'this_month':
      return { from: firstOfMonth(today), to: today }
    case 'last_30':
      return { from: addDays(today, -29), to: today }
  }
}

export type BalanceTone = 'owed' | 'owes' | 'even' | 'unset'

export interface BalanceWording {
  tone: BalanceTone
  headline: string
  detail: string
}

/**
 * What the balance means, in plain words. `viewer` is who reads it: the barber themself, or the owner looking at a
 * barber's statement. Positive = the shop owes the barber; negative = the barber owes the shop.
 */
export function balanceWording(e: Pick<EarningsDto, 'balanceCents' | 'terms' | 'displayName'>, viewer: 'barber' | 'owner' = 'barber'): BalanceWording {
  const name = e.displayName.replace(/\s*\(.*?\)\s*/g, ' ').trim() || 'This barber'
  if (!e.terms.mode)
    return viewer === 'barber'
      ? { tone: 'unset', headline: 'Nothing calculated yet', detail: 'Ask the owner to set your pay terms (commission, chair rent or wage).' }
      : { tone: 'unset', headline: 'No pay terms set', detail: `Set ${name}’s pay terms to calculate a statement.` }
  const amount = formatZAR(Math.abs(e.balanceCents))
  const rent = e.terms.mode === 'chair_rent'
  if (e.balanceCents > 0)
    return viewer === 'barber'
      ? { tone: 'owed', headline: `The shop owes you ${amount}`, detail: 'For this period, after what was already paid out.' }
      : { tone: 'owed', headline: `Shop owes ${amount}`, detail: `To ${name}, after payouts already recorded.` }
  if (e.balanceCents < 0)
    return viewer === 'barber'
      ? { tone: 'owes', headline: `You owe the shop ${amount}${rent ? ' (chair rent)' : ''}`, detail: 'For this period, after what was already received.' }
      : { tone: 'owes', headline: `${name} owes ${amount}`, detail: rent ? 'Chair rent still to receive for this period.' : 'Still to receive for this period.' }
  return { tone: 'even', headline: 'All square', detail: viewer === 'barber' ? 'Nothing owed either way for this period.' : 'Nothing owed either way for this period.' }
}

/** The payout direction and default amount for "Record payout": what settles the balance. */
export function defaultPayout(balanceCents: number): { direction: 'to_barber' | 'from_barber'; amountCents: number } {
  return balanceCents < 0 ? { direction: 'from_barber', amountCents: -balanceCents } : { direction: 'to_barber', amountCents: Math.max(0, balanceCents) }
}

/** Every day of the period (up to 62 days), with zero for days without completed visits, for the daily chart. */
export function fillDays(from: string, to: string, days: readonly EarningsDto['days'][number][]): { date: string; visits: number; servicesCents: number }[] {
  const at = new Map(days.map((d) => [d.date, d]))
  const out: { date: string; visits: number; servicesCents: number }[] = []
  for (let d = from, i = 0; d <= to && i < 62; d = addDays(d, 1), i++) {
    const x = at.get(d)
    out.push({ date: d, visits: x?.visits ?? 0, servicesCents: x?.servicesCents ?? 0 })
  }
  return out
}
