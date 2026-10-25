import { describe, expect, it } from 'vitest'
import {
  accountDigits,
  bookingButtons,
  bookingStatusLabel,
  canOfferException,
  debtStatusTone,
  durationLabel,
  evidenceLink,
  figureTone,
  formatDayLabel,
  formatTime,
  groupByPerson,
  groupSlots,
  isDuplicatePaymentConflict,
  isNotAddedLine,
  itemsFromPeople,
  jhbDate,
  jhbIso,
  orderFigures,
  quickActions,
  serviceIdsFromLabels,
  servicesTotal,
  slotsByPeriod,
  staffStatusLabel,
  staffStatusTone,
  validateHours,
  weekdayOf,
} from './barbershop'
import { canOpenPath, roleLabel } from './access'
import type { SlotDto } from '@/types/barbershop'

describe('staff status labels', () => {
  it.each([
    ['available', 'Available'],
    ['busy', 'Busy'],
    ['house_call', 'On a house call'],
    ['on_break', 'On break'],
    ['unavailable', 'Unavailable'],
    ['off_duty', 'Off duty'],
  ])('%s -> %s', (s, label) => expect(staffStatusLabel(s)).toBe(label))

  it('passes unknown statuses through and handles empty values', () => {
    expect(staffStatusLabel('future')).toBe('future')
    expect(staffStatusLabel(null)).toBe('—')
  })

  it('only colours available as success', () => {
    expect(staffStatusTone('available')).toBe('success')
    expect(staffStatusTone('busy')).toBe('warning')
    expect(staffStatusTone('off_duty')).toBe('neutral')
  })
})

describe('role labels', () => {
  it('uses the barbershop wording', () => {
    expect(roleLabel('staff')).toBe('Barber / employee')
    expect(roleLabel('cashier')).toBe('Cashier / receptionist')
    expect(roleLabel('branch_manager')).toBe('Business manager')
  })
})

describe('booking actions', () => {
  it('maps allowedActions to buttons in a stable order and ignores unknown actions', () => {
    const b = bookingButtons(['cancel', 'complete', 'propose_reschedule', 'no_show', 'teleport'])
    expect(b.map((x) => x.action)).toEqual(['complete', 'propose_reschedule', 'no_show', 'cancel'])
    expect(b[0].label).toBe('Complete visit')
  })

  it('shows accept / reject for a customer proposal and de-duplicates', () => {
    expect(bookingButtons(['reject_proposal', 'accept_proposal', 'accept_proposal']).map((x) => x.action)).toEqual(['accept_proposal', 'reject_proposal'])
    expect(bookingButtons(null)).toEqual([])
  })

  it('offers quick actions that follow the state machine', () => {
    const now = Date.parse('2026-10-16T10:00:00Z')
    expect(quickActions({ status: 'requested', startsAt: '2026-10-17T08:00:00Z', proposedBy: null }, now)).toEqual(['confirm', 'propose_reschedule'])
    expect(quickActions({ status: 'confirmed', startsAt: '2026-10-17T08:00:00Z', proposedBy: null }, now)).toEqual(['propose_reschedule'])
    expect(quickActions({ status: 'confirmed', startsAt: '2026-10-16T08:00:00Z', proposedBy: null }, now)).toEqual(['complete', 'no_show'])
    expect(quickActions({ status: 'reschedule_proposed', startsAt: '2026-10-17T08:00:00Z', proposedBy: 'customer' }, now)).toEqual(['accept_proposal', 'reject_proposal'])
    expect(quickActions({ status: 'reschedule_proposed', startsAt: '2026-10-17T08:00:00Z', proposedBy: 'business' }, now)).toEqual([])
    expect(quickActions({ status: 'completed', startsAt: '2026-10-15T08:00:00Z', proposedBy: null }, now)).toEqual([])
  })

  it('offers an approved exception only to owner/admin when the API mentions one', () => {
    const detail = 'Bongani is off duty at that time. The owner can confirm an exception if the business allows it.'
    expect(canOfferException('owner', detail, true)).toBe(true)
    expect(canOfferException('business_admin', detail, undefined)).toBe(true)
    expect(canOfferException('cashier', detail, true)).toBe(false)
    expect(canOfferException('owner', detail, false)).toBe(false)
    expect(canOfferException('owner', 'Bongani already has a confirmed appointment that overlaps this time.', true)).toBe(false)
  })

  it('labels booking statuses', () => {
    expect(bookingStatusLabel('no_show')).toBe('No-show')
    expect(bookingStatusLabel('reschedule_proposed')).toBe('Reschedule proposed')
  })
})

describe('Johannesburg time helpers', () => {
  it('formats instants in SAST regardless of the offset given', () => {
    expect(formatTime('2026-10-17T07:30:00+00:00')).toBe('09:30')
    expect(formatTime('2026-10-17T09:30:00+02:00')).toBe('09:30')
    expect(jhbDate('2026-10-16T22:30:00Z')).toBe('2026-10-17')
  })

  it('builds +02:00 timestamps and day labels', () => {
    expect(jhbIso('2026-10-17', '08:15')).toBe('2026-10-17T08:15:00+02:00')
    expect(formatDayLabel('2026-10-17')).toBe('Sat 17 Oct')
    expect(weekdayOf('2026-10-18')).toBe(0)
  })

  it('formats durations', () => {
    expect(durationLabel(25)).toBe('25 min')
    expect(durationLabel(60)).toBe('1 h')
    expect(durationLabel(85)).toBe('1 h 25 min')
    expect(durationLabel(0)).toBe('—')
  })
})

describe('slot grouping', () => {
  const s = (startsAt: string, staffId: string, staffName = staffId): SlotDto => ({ startsAt, endsAt: startsAt, staffId, staffName })
  const slots = [
    s('2026-10-17T13:00:00+02:00', 'b', 'Bongani'),
    s('2026-10-17T08:00:00+02:00', 'a', 'Ayanda'),
    s('2026-10-17T08:00:00+02:00', 'b', 'Bongani'),
    s('2026-10-17T06:00:00Z', 'a', 'Ayanda'), // same instant as 08:00 SAST
    s('2026-10-17T17:30:00+02:00', 'a', 'Ayanda'),
  ]

  it('groups one entry per start time, sorted, with each free barber once', () => {
    const g = groupSlots(slots)
    expect(g.map((x) => x.time)).toEqual(['08:00', '13:00', '17:30'])
    expect(g[0].staff.map((x) => x.staffName)).toEqual(['Ayanda', 'Bongani'])
  })

  it('filters to one barber', () => {
    expect(groupSlots(slots, 'b').map((x) => x.time)).toEqual(['08:00', '13:00'])
  })

  it('buckets into morning / afternoon / evening', () => {
    expect(slotsByPeriod(groupSlots(slots)).map((p) => [p.period, p.slots.length])).toEqual([
      ['Morning', 1],
      ['Afternoon', 1],
      ['Evening', 1],
    ])
  })
})

describe('working hours validation', () => {
  it('accepts split days and rejects overlaps, reversed blocks and too many blocks', () => {
    expect(validateHours([{ weekday: 1, start: '08:00', end: '12:00' }, { weekday: 1, start: '14:00', end: '18:00' }])).toBeNull()
    expect(validateHours([{ weekday: 1, start: '08:00', end: '12:00' }, { weekday: 1, start: '11:00', end: '18:00' }])).toMatch(/overlap/)
    expect(validateHours([{ weekday: 2, start: '12:00', end: '08:00' }])).toMatch(/start before/)
    const four = ['08:00', '10:00', '12:00', '14:00'].map((st) => ({ weekday: 3, start: st, end: st.replace(/^(\d\d)/, (h) => String(Number(h) + 1).padStart(2, '0')) }))
    expect(validateHours(four)).toMatch(/at most 3/)
  })
})

describe('people and services', () => {
  const services = [
    { id: 'cut', name: 'Haircut', priceCents: 8000, durationMinutes: 30 },
    { id: 'kid', name: 'Kids cut (under 12)', priceCents: 6000, durationMinutes: 25 },
  ]

  it('sums prices and durations across people', () => {
    expect(servicesTotal([{ serviceIds: ['cut'] }, { serviceIds: ['kid'] }, { serviceIds: ['kid'] }], services)).toEqual({ totalCents: 20000, durationMinutes: 80, count: 3 })
  })

  it('labels people only when several are booked', () => {
    expect(itemsFromPeople([{ label: '', serviceIds: ['cut'] }])).toEqual([{ serviceId: 'cut', personLabel: null }])
    expect(itemsFromPeople([{ label: 'Dad', serviceIds: ['cut'] }, { label: '', serviceIds: ['kid'] }])).toEqual([
      { serviceId: 'cut', personLabel: 'Dad' },
      { serviceId: 'kid', personLabel: 'Person 2' },
    ])
  })

  it('groups booking items by person', () => {
    const g = groupByPerson([
      { personLabel: 'Person 1', n: 1 },
      { personLabel: 'Person 2', n: 2 },
      { personLabel: 'Person 1', n: 3 },
    ])
    expect(g.map((x) => [x.person, x.items.length])).toEqual([
      ['Person 1', 2],
      ['Person 2', 1],
    ])
  })

  it('maps public status service labels back to ids', () => {
    expect(serviceIdsFromLabels(['Person 1: Kids cut (under 12)', 'Person 2: Haircut', 'Gone service'], services)).toEqual(['kid', 'cut'])
  })
})

describe('money figures', () => {
  it('orders the panel figures and keeps unknown keys at the end', () => {
    const f = (key: string) => ({ key, label: key, amountCents: 0, explanation: '' })
    expect(orderFigures([f('bills'), f('new_thing'), f('sales'), f('received')]).map((x) => x.key)).toEqual(['sales', 'received', 'bills', 'new_thing'])
  })

  it('flags a negative contribution and money still to come in', () => {
    expect(figureTone({ key: 'contribution', amountCents: -68000 })).toBe('critical')
    expect(figureTone({ key: 'contribution', amountCents: 100 })).toBe('positive')
    expect(figureTone({ key: 'pending', amountCents: 50000 })).toBe('warning')
    expect(figureTone({ key: 'sales', amountCents: 114000 })).toBe('default')
  })
})

describe('debts and payments', () => {
  it('marks proposed / waived / reversed statement lines as not added', () => {
    expect(isNotAddedLine('charge_proposed')).toBe(true)
    expect(isNotAddedLine('charge_applied')).toBe(false)
    expect(isNotAddedLine('payment')).toBe(false)
  })

  it('detects the duplicate-payment 409', () => {
    expect(isDuplicatePaymentConflict(409, 'The same payment was recorded a few minutes ago. If this really is a second payment, confirm it as a separate payment.')).toBe(true)
    expect(isDuplicatePaymentConflict(409, 'This debt is already fully paid.')).toBe(false)
    expect(isDuplicatePaymentConflict(400, 'separate payment')).toBe(false)
  })

  it('tones debt statuses', () => {
    expect(debtStatusTone('overdue')).toBe('critical')
    expect(debtStatusTone('settled')).toBe('success')
  })

  it('keeps only account digits', () => {
    expect(accountDigits('62 1234-5678 9930')).toBe('62123456789930')
  })
})

describe('alert evidence links', () => {
  it('links known record types and ignores the rest', () => {
    expect(evidenceLink('booking', 'b1')).toBe('/bookings/b1')
    expect(evidenceLink('receivable', 'r1')).toBe('/debts/r1')
    expect(evidenceLink('transaction', 't1')).toBe('/transactions/t1')
    expect(evidenceLink('supplier_bank_details', 'x')).toBe('/suppliers?tab=suppliers')
    expect(evidenceLink('mystery', 'x')).toBeNull()
    expect(evidenceLink('booking', null)).toBeNull()
  })
})

describe('navigation per role', () => {
  const BARBER = ['recordSales', 'viewInventory', 'recordStockAdjustment', 'viewFraud', 'workOwnBookings', 'updateOwnStatus', 'viewTeamStatus', 'operateShift']
  const CASHIER = ['recordSales', 'operateShift', 'viewInventory', 'recordStockAdjustment', 'viewFraud', 'viewBookings', 'manageBookings', 'viewTeamStatus', 'recordDebtPayments']

  it('guards the new routes', () => {
    expect(canOpenPath(BARBER, '/workspace')).toBe(true)
    expect(canOpenPath(BARBER, '/bookings/abc')).toBe(true)
    expect(canOpenPath(BARBER, '/debts')).toBe(false)
    expect(canOpenPath(CASHIER, '/debts/abc')).toBe(true)
    expect(canOpenPath(CASHIER, '/customers/debts/abc')).toBe(true)
    expect(canOpenPath(CASHIER, '/customers')).toBe(false)
    expect(canOpenPath(CASHIER, '/alerts')).toBe(false)
    expect(canOpenPath(BARBER, '/business-profile')).toBe(false)
  })
})
