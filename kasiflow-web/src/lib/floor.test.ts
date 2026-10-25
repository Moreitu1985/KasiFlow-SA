import { describe, expect, it } from 'vitest'
import { chairsByBarber, sortAttention, stillOpen, teamBoard } from './floor'
import type { BookingSummaryDto, FloorAttentionDto, FloorTeamMemberDto } from '@/types/barbershop'

const att = (kind: FloorAttentionDto['kind'], severity: FloorAttentionDto['severity']): FloorAttentionDto => ({ kind, severity, title: kind, detail: '', link: '/' })
const member = (displayName: string, status: FloorTeamMemberDto['status'], availableNow = status === 'available'): FloorTeamMemberDto => ({
  id: displayName,
  displayName,
  roleTitle: 'Barber',
  status,
  statusLabel: status,
  availableNow,
  stale: false,
  note: null,
  bookingsToday: 0,
  nextAt: null,
})
const booking = (id: string, startsAt: string, staffId: string | null, status: BookingSummaryDto['status'] = 'confirmed'): BookingSummaryDto => ({
  id,
  reference: id,
  status,
  statusLabel: status,
  startsAt,
  endsAt: startsAt,
  staffId,
  staffName: staffId ? `Barber ${staffId}` : null,
  customerName: 'C',
  locationType: 'in_shop',
  peopleCount: 1,
  totalCents: 0,
  paidCents: 0,
  servicesSummary: '',
  proposedStartsAt: null,
  proposedBy: null,
})

describe('floor helpers', () => {
  it('puts critical safety items first', () => {
    const sorted = sortAttention([att('alerts', 'warning'), att('bookings', 'warning'), att('team', 'informational'), att('safety', 'critical'), att('shifts', 'critical')])
    expect(sorted.map((a) => `${a.severity}:${a.kind}`)).toEqual(['critical:safety', 'critical:shifts', 'warning:bookings', 'warning:alerts', 'informational:team'])
  })

  it('lists who is free first, people who are away last', () => {
    const board = teamBoard([member('Neo', 'off_duty'), member('Bongani', 'busy'), member('Thato', 'available'), member('Ayanda', 'house_call')])
    expect(board.map((m) => m.displayName)).toEqual(['Thato', 'Bongani', 'Ayanda', 'Neo'])
  })

  it('groups today by barber in time order with unassigned requests last', () => {
    const groups = chairsByBarber([booking('3', '2026-10-23T12:00:00Z', null), booking('2', '2026-10-23T10:00:00Z', 'b'), booking('1', '2026-10-23T09:00:00Z', 'a'), booking('4', '2026-10-23T08:00:00Z', 'b')])
    expect(groups.map((g) => g.key)).toEqual(['b', 'a', 'any'])
    expect(groups[0]!.items.map((b) => b.id)).toEqual(['4', '2'])
    expect(groups[2]!.name).toBe('Any barber')
  })

  it('knows which bookings are still open', () => {
    expect(stillOpen(booking('1', '', null, 'requested'))).toBe(true)
    expect(stillOpen(booking('1', '', null, 'completed'))).toBe(false)
    expect(stillOpen(booking('1', '', null, 'no_show'))).toBe(false)
  })
})
