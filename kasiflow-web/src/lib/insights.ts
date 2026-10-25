/** Pure helpers for the owner's shop insights: the weekday × hour heatmap. Values are completed visits. */
import type { HeatCellDto } from '@/types/pro'

/** Rows Monday first (the API counts 0 = Sunday). */
export const HEAT_DAYS: { weekday: number; short: string; long: string }[] = [
  { weekday: 1, short: 'Mon', long: 'Monday' },
  { weekday: 2, short: 'Tue', long: 'Tuesday' },
  { weekday: 3, short: 'Wed', long: 'Wednesday' },
  { weekday: 4, short: 'Thu', long: 'Thursday' },
  { weekday: 5, short: 'Fri', long: 'Friday' },
  { weekday: 6, short: 'Sat', long: 'Saturday' },
  { weekday: 0, short: 'Sun', long: 'Sunday' },
]

export const HEAT_HOURS: readonly number[] = Array.from({ length: 12 }, (_, i) => 8 + i) // 08:00 … 19:00

export interface HeatRow {
  weekday: number
  short: string
  long: string
  cells: { hour: number; visits: number }[]
  total: number
}

export interface HeatGrid {
  rows: HeatRow[]
  max: number
  total: number
  /** Visits outside the hours shown (early or late), so nothing silently disappears. */
  outside: number
}

/** Shapes the API's sparse cells into 7 rows (Mon–Sun) × the given hours, filling gaps with 0. */
export function heatGrid(cells: readonly HeatCellDto[], hours: readonly number[] = HEAT_HOURS): HeatGrid {
  const at = new Map<string, number>()
  let all = 0
  for (const c of cells) {
    const k = `${c.weekday}:${c.hour}`
    at.set(k, (at.get(k) ?? 0) + c.visits)
    all += c.visits
  }
  let max = 0
  let shown = 0
  const rows = HEAT_DAYS.map((d) => {
    const row = hours.map((h) => ({ hour: h, visits: at.get(`${d.weekday}:${h}`) ?? 0 }))
    const total = row.reduce((s, c) => s + c.visits, 0)
    shown += total
    for (const c of row) max = Math.max(max, c.visits)
    return { ...d, cells: row, total }
  })
  return { rows, max, total: all, outside: all - shown }
}

/** Intensity step 0 (none) … 5 (busiest), relative to the busiest cell. */
export function heatLevel(visits: number, max: number): number {
  if (visits <= 0 || max <= 0) return 0
  return Math.min(5, Math.max(1, Math.ceil((visits / max) * 5)))
}

export function hourLabel(h: number): string {
  return `${String(h).padStart(2, '0')}:00`
}
