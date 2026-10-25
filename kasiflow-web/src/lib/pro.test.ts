import { describe, expect, it } from 'vitest'
import type { EarningsDto, QueueTicketDto } from '@/types/pro'
import { actionPath, chairProgress, currentTicketFor, displayName, minutesSince, nextTicketFor, priceFromSummary, queueColumns } from './queue'
import { balanceWording, defaultPayout, fillDays, mondayOf, payPeriodRange } from './earnings'
import { heatGrid, heatLevel, hourLabel } from './insights'
import { parseThemePref, resolveTheme } from './theme'
import { boundsFor, directionsUrl, isValidLatLng, roundCoord } from './geo'

const ME = 'me'
const OTHER = 'other'

function t(over: Partial<QueueTicketDto>): QueueTicketDto {
  return {
    id: String(over.number ?? 1),
    number: 1,
    customerName: 'Thabo N.',
    status: 'waiting',
    statusLabel: 'Waiting',
    servicesSummary: 'Fade',
    estMinutes: 30,
    preferredStaffId: null,
    preferredStaffName: null,
    staffId: null,
    staffName: null,
    joinedAt: '2026-10-25T10:00:00Z',
    calledAt: null,
    startedAt: null,
    finishedAt: null,
    position: null,
    waitLabel: null,
    waitedMinutes: 0,
    source: 'desk',
    bookingId: null,
    allowedActions: ['call', 'start'],
    ...over,
  }
}

describe('walk-in queue', () => {
  const open = [
    t({ id: 'a', number: 1, status: 'in_chair', staffId: OTHER, startedAt: '2026-10-25T10:05:00Z', allowedActions: ['done'] }),
    t({ id: 'b', number: 2, position: 1, preferredStaffId: OTHER }),
    t({ id: 'c', number: 3, position: 2 }),
    t({ id: 'd', number: 4, position: 3, preferredStaffId: ME }),
  ]

  it('calls the first person who asked for me or for anyone, leaving colleagues’ customers alone', () => {
    expect(nextTicketFor(open, ME)?.id).toBe('c')
    expect(nextTicketFor(open, OTHER)?.id).toBe('b')
    expect(nextTicketFor([open[1]], ME)).toBeNull()
    expect(nextTicketFor(open, null)).toBeNull()
  })

  it('skips tickets this person may not call', () => {
    const locked = open.map((x) => (x.id === 'c' ? { ...x, allowedActions: [] } : x))
    expect(nextTicketFor(locked, ME)?.id).toBe('d')
  })

  it('finds my own customer, in the chair before called', () => {
    const mine = [t({ id: 'x', status: 'called', staffId: ME }), t({ id: 'y', status: 'in_chair', staffId: ME })]
    expect(currentTicketFor(mine, ME)?.id).toBe('y')
    expect(currentTicketFor(open, ME)).toBeNull()
  })

  it('splits the board into columns in queue order', () => {
    const cols = queueColumns([open[3], open[2], open[0]])
    expect(cols.inChair.map((x) => x.id)).toEqual(['a'])
    expect(cols.waiting.map((x) => x.id)).toEqual(['c', 'd'])
    expect(cols.called).toEqual([])
  })

  it('measures time in the chair against the estimate', () => {
    const now = new Date('2026-10-25T10:45:00Z').getTime()
    expect(minutesSince('2026-10-25T10:05:00Z', now)).toBe(40)
    expect(minutesSince(null, now)).toBe(0)
    expect(minutesSince('2026-10-25T11:00:00Z', now)).toBe(0)
    expect(chairProgress(15, 30)).toMatchObject({ percent: 50, over: false })
    expect(chairProgress(40, 30)).toMatchObject({ percent: 100, over: true, label: '40 min · 10 min over the estimate' })
  })

  it('prefills the price only when every service is known', () => {
    const prices = [
      { serviceName: 'Line-up', priceCents: 4000 },
      { serviceName: 'Beard trim', priceCents: 5000 },
    ]
    expect(priceFromSummary('Line-up, Beard trim', prices)).toBe(9000)
    expect(priceFromSummary('Haircut (to be confirmed)', prices)).toBeNull()
    expect(priceFromSummary('', prices)).toBeNull()
  })

  it('tidies shortened names without inventing anything', () => {
    expect(displayName('Thabo (.')).toBe('Thabo')
    expect(displayName('Walk T.')).toBe('Walk T.')
    expect(displayName('Thabo N. (fictional)')).toBe('Thabo N. (fictional)')
  })

  it('maps actions to URL segments', () => {
    expect(actionPath('no_show')).toBe('no-show')
    expect(actionPath('call')).toBe('call')
  })
})

describe('barber pay', () => {
  it('works out pay periods (weeks start on Monday)', () => {
    expect(mondayOf('2026-10-25')).toBe('2026-10-19') // Sunday
    expect(mondayOf('2026-10-19')).toBe('2026-10-19')
    expect(payPeriodRange('this_week', '2026-10-25')).toEqual({ from: '2026-10-19', to: '2026-10-25' })
    expect(payPeriodRange('last_week', '2026-10-21')).toEqual({ from: '2026-10-12', to: '2026-10-18' })
    expect(payPeriodRange('this_month', '2026-10-25')).toEqual({ from: '2026-10-01', to: '2026-10-25' })
    expect(payPeriodRange('last_30', '2026-10-25')).toEqual({ from: '2026-09-26', to: '2026-10-25' })
  })

  const terms = (mode: EarningsDto['terms']['mode']) => ({ staffId: 's', mode, modeLabel: null, commissionPercent: null, chairRentWeeklyCents: null, wageWeeklyCents: null })

  it('says who owes whom in plain words', () => {
    expect(balanceWording({ balanceCents: 35100, terms: terms('commission'), displayName: 'Ayanda (fictional)' }).headline).toBe('The shop owes you R351.00')
    expect(balanceWording({ balanceCents: -50000, terms: terms('chair_rent'), displayName: 'Ayanda' }).headline).toBe('You owe the shop R500.00 (chair rent)')
    expect(balanceWording({ balanceCents: 0, terms: terms('wage'), displayName: 'Ayanda' }).tone).toBe('even')
    const unset = balanceWording({ balanceCents: 0, terms: terms(null), displayName: 'Ayanda' })
    expect(unset.tone).toBe('unset')
    expect(unset.detail).toMatch(/ask the owner/i)
  })

  it('words the owner’s view by name, without the "(fictional)" note', () => {
    expect(balanceWording({ balanceCents: 35100, terms: terms('commission'), displayName: 'Ayanda (fictional)' }, 'owner').detail).toBe('To Ayanda, after payouts already recorded.')
    expect(balanceWording({ balanceCents: -100, terms: terms('chair_rent'), displayName: 'Bo' }, 'owner').headline).toBe('Bo owes R1.00')
  })

  it('fills the daily chart with zero days', () => {
    const d = fillDays('2026-10-19', '2026-10-22', [{ date: '2026-10-20', visits: 2, servicesCents: 16000 }])
    expect(d.map((x) => x.date)).toEqual(['2026-10-19', '2026-10-20', '2026-10-21', '2026-10-22'])
    expect(d.map((x) => x.visits)).toEqual([0, 2, 0, 0])
    expect(fillDays('2026-10-22', '2026-10-19', [])).toEqual([])
  })

  it('defaults a payout to whatever settles the balance', () => {
    expect(defaultPayout(35100)).toEqual({ direction: 'to_barber', amountCents: 35100 })
    expect(defaultPayout(-50000)).toEqual({ direction: 'from_barber', amountCents: 50000 })
    expect(defaultPayout(0)).toEqual({ direction: 'to_barber', amountCents: 0 })
  })
})

describe('insights heatmap', () => {
  const grid = heatGrid([
    { weekday: 0, hour: 9, visits: 2 }, // Sunday
    { weekday: 5, hour: 14, visits: 8 }, // Friday
    { weekday: 6, hour: 7, visits: 3 }, // before opening hours shown
  ])

  it('makes 7 rows Monday to Sunday with 12 hours each, gaps filled with zero', () => {
    expect(grid.rows.map((r) => r.short)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    expect(grid.rows.every((r) => r.cells.length === 12)).toBe(true)
    expect(grid.rows[4].cells.find((c) => c.hour === 14)?.visits).toBe(8)
    expect(grid.rows[6].cells.find((c) => c.hour === 9)?.visits).toBe(2)
    expect(grid.rows[0].total).toBe(0)
  })

  it('keeps the totals honest, including visits outside the hours shown', () => {
    expect(grid.max).toBe(8)
    expect(grid.total).toBe(13)
    expect(grid.outside).toBe(3)
  })

  it('scales intensity relative to the busiest slot', () => {
    expect(heatLevel(0, 8)).toBe(0)
    expect(heatLevel(1, 8)).toBe(1)
    expect(heatLevel(8, 8)).toBe(5)
    expect(heatLevel(3, 0)).toBe(0)
    expect(hourLabel(8)).toBe('08:00')
  })
})

describe('theme', () => {
  it('follows the phone on System, otherwise the choice', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('light', true)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('treats anything unknown in storage as System', () => {
    expect(parseThemePref('dark')).toBe('dark')
    expect(parseThemePref('purple')).toBe('system')
    expect(parseThemePref(null)).toBe('system')
  })
})

describe('map helpers', () => {
  it('pads a single pin to a street-level box', () => {
    const b = boundsFor([{ lat: -26.2378, lng: 27.9089 }])!
    expect(b.south).toBeLessThan(-26.2378)
    expect(b.north).toBeGreaterThan(-26.2378)
    expect(b.north - b.south).toBeCloseTo(0.006, 5)
    expect(b.east - b.west).toBeCloseTo(0.006, 5)
  })

  it('covers every valid pin and ignores broken ones', () => {
    const b = boundsFor([
      { lat: -26.2, lng: 27.9 },
      { lat: -26.3, lng: 28.1 },
      { lat: Number.NaN, lng: 0 },
      { lat: 120, lng: 0 },
    ])!
    expect(b.south).toBeLessThan(-26.3)
    expect(b.north).toBeGreaterThan(-26.2)
    expect(b.west).toBeLessThan(27.9)
    expect(b.east).toBeGreaterThan(28.1)
    expect(boundsFor([])).toBeNull()
  })

  it('validates coordinates and builds directions links', () => {
    expect(isValidLatLng(-26.2, 27.9)).toBe(true)
    expect(isValidLatLng(-91, 27.9)).toBe(false)
    expect(isValidLatLng(null, 27.9)).toBe(false)
    expect(roundCoord(-26.23781234)).toBe(-26.237812)
    expect(directionsUrl(-26.2378, 27.9089)).toBe('https://www.google.com/maps/dir/?api=1&destination=-26.2378,27.9089')
  })
})
