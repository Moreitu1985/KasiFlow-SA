import { todayJhb } from './format'

export function firstOfMonth(ymd: string, monthsBack = 0): string {
  const [y, m] = ymd.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 - monthsBack, 1))
  return d.toISOString().slice(0, 10)
}

export function lastOfMonth(ymd: string, monthsBack = 0): string {
  const [y, m] = ymd.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - monthsBack, 0))
  return d.toISOString().slice(0, 10)
}

export const RANGE_PRESETS = [
  { key: 'this_month', label: 'This month', range: () => ({ from: firstOfMonth(todayJhb()), to: todayJhb() }) },
  { key: 'last_month', label: 'Last month', range: () => ({ from: firstOfMonth(todayJhb(), 1), to: lastOfMonth(todayJhb(), 1) }) },
  { key: 'last_3', label: 'Last 3 months', range: () => ({ from: firstOfMonth(todayJhb(), 2), to: todayJhb() }) },
  { key: 'last_6', label: 'Last 6 months', range: () => ({ from: firstOfMonth(todayJhb(), 5), to: todayJhb() }) },
  { key: 'this_year', label: 'This year', range: () => ({ from: `${todayJhb().slice(0, 4)}-01-01`, to: todayJhb() }) },
] as const
