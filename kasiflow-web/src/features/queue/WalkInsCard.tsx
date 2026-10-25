import { Link } from 'react-router-dom'
import { Armchair, ChevronRight, Hourglass, ListOrdered, Users } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { displayName, nextTicketFor } from '@/lib/queue'
import { cn } from '@/lib/utils'
import { useQueueBoard } from './api'

/** A compact look at the walk-in queue for the barber's workspace and the manager's floor. */
export function WalkInsCard({ staffId, className }: { staffId?: string | null; className?: string }) {
  const q = useQueueBoard()
  const b = q.data
  if (q.isError) return null
  const next = b && staffId ? nextTicketFor(b.open, staffId) : null
  return (
    <Link
      to="/queue"
      className={cn('lift group flex min-w-0 flex-col gap-3 rounded-2xl border border-line bg-surface p-4 shadow-card sm:flex-row sm:items-center', className)}
      aria-label="Open the walk-in queue"
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-emerald-brand text-forest-950" aria-hidden>
          <ListOrdered className="size-5" />
        </span>
        <div className="min-w-0">
          <p className="font-semibold">Walk-ins</p>
          {b ? (
            <p className="truncate text-[13px] text-ink-soft">
              {next ? `Next for you: #${next.number} ${displayName(next.customerName)}` : b.waiting === 0 ? 'Nobody waiting right now' : `Next wait ${b.nextWaitLabel.toLowerCase()} (estimate)`}
            </p>
          ) : (
            <Skeleton className="mt-1 h-3.5 w-40" />
          )}
        </div>
      </div>
      {b && (
        <ul className="flex shrink-0 items-center gap-4 text-sm">
          <li className="inline-flex items-center gap-1.5" title="Waiting">
            <Users className="size-4 text-ink-muted" aria-hidden />
            <span className="font-display text-xl font-bold tabular">{b.waiting}</span>
            <span className="text-[12px] text-ink-muted">waiting</span>
          </li>
          <li className="inline-flex items-center gap-1.5" title="In the chair">
            <Armchair className="size-4 text-ink-muted" aria-hidden />
            <span className="font-display text-xl font-bold tabular">{b.inChair}</span>
            <span className="text-[12px] text-ink-muted">in chair</span>
          </li>
          <li className="hidden items-center gap-1.5 md:inline-flex" title="Average wait today">
            <Hourglass className="size-4 text-ink-muted" aria-hidden />
            <span className="text-[13px] font-semibold">{b.averageWaitMinutes == null ? '—' : `${b.averageWaitMinutes} min`}</span>
          </li>
          <ChevronRight className="ml-auto size-5 text-ink-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
        </ul>
      )}
    </Link>
  )
}
