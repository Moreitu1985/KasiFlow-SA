import { Car } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { StaffStatusBadge } from '@/components/shared/StatusBadges'
import { formatTime } from '@/lib/barbershop'
import type { StaffProfileDto } from '@/types/barbershop'

/** Colleagues' live statuses. "Available" is only a status someone set; it is not a promise of immediate service. */
export function TeamStatusList({ team, title = 'Team right now' }: { team: StaffProfileDto[]; title?: string }) {
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>Statuses are set by each person. Busy, on break and house-call statuses fade if not updated.</CardDescription>
      </CardHeader>
      <CardContent>
        {team.length === 0 ? (
          <p className="text-sm text-ink-muted">No team profiles yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {team.map((s) => (
              <li key={s.id} className="flex items-start gap-3 py-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-forest-50 text-sm font-bold text-heading" aria-hidden>
                  {s.displayName.charAt(0)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {s.displayName} {s.isYou && <span className="font-normal text-ink-muted">(you)</span>}
                  </p>
                  <p className="text-[12px] text-ink-muted">
                    {s.roleTitle} · {s.bookingsToday} {s.bookingsToday === 1 ? 'booking' : 'bookings'} today
                    {s.acceptsHouseCalls && (
                      <span className="ml-1 inline-flex items-center gap-0.5">
                        · <Car className="size-3" aria-hidden /> house calls
                      </span>
                    )}
                  </p>
                  {s.status.note && <p className="text-[12px] text-ink-soft">“{s.status.note}”</p>}
                </div>
                <div className="flex shrink-0 flex-col items-end gap-0.5">
                  <StaffStatusBadge status={s.status.status} label={s.status.label} stale={s.status.stale} />
                  {s.status.expiresAt && <span className="text-[11px] text-ink-muted">until {formatTime(s.status.expiresAt)}</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
