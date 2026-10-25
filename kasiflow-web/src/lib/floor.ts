/** Pure helpers for the manager's "Today on the floor" screen (kept here so they can be unit-tested). */
import type { BookingSummaryDto, FloorAttentionDto, FloorTeamMemberDto } from '@/types/barbershop'

const SEVERITY_RANK: Record<string, number> = { critical: 0, warning: 1, informational: 2 }
const KIND_RANK: Record<string, number> = { safety: 0, bookings: 1, shifts: 2, alerts: 3, team: 4 }

/** Critical first, and within the same severity a barber's safety always comes before paperwork. */
export function sortAttention(items: readonly FloorAttentionDto[]): FloorAttentionDto[] {
  return [...items].sort(
    (a, b) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9) || (KIND_RANK[a.kind] ?? 9) - (KIND_RANK[b.kind] ?? 9),
  )
}

/** Who's free first, then who is working (busy / house call), then breaks, then people who are away. */
const STATUS_RANK: Record<string, number> = { available: 0, busy: 1, house_call: 2, on_break: 3, unavailable: 4, off_duty: 5 }

export function teamBoard(team: readonly FloorTeamMemberDto[]): FloorTeamMemberDto[] {
  return [...team].sort(
    (a, b) =>
      Number(b.availableNow) - Number(a.availableNow) ||
      (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) ||
      a.displayName.localeCompare(b.displayName),
  )
}

export interface ChairGroup {
  key: string
  name: string
  items: BookingSummaryDto[]
}

/** Today's bookings per barber (in time order), with "Any barber" requests last. */
export function chairsByBarber(list: readonly BookingSummaryDto[]): ChairGroup[] {
  const groups = new Map<string, ChairGroup>()
  for (const b of [...list].sort((x, y) => x.startsAt.localeCompare(y.startsAt))) {
    const key = b.staffId ?? 'any'
    const g = groups.get(key) ?? { key, name: b.staffName ?? 'Any barber', items: [] }
    g.items.push(b)
    groups.set(key, g)
  }
  return [...groups.values()].sort((a, b) => Number(a.key === 'any') - Number(b.key === 'any') || a.items[0]!.startsAt.localeCompare(b.items[0]!.startsAt))
}

/** Bookings still to come or in the chair (not finished, cancelled or no-show). */
export function stillOpen(b: BookingSummaryDto): boolean {
  return b.status === 'requested' || b.status === 'confirmed' || b.status === 'reschedule_proposed'
}
