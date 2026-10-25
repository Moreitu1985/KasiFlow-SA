import { History } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { formatDateTime, humanize } from '@/lib/format'
import type { ConnectionDto } from '@/types/automation'
import { useConnectionActivity } from './api'

function statusVariant(status: string): 'success' | 'warning' | 'critical' | 'neutral' | 'info' {
  const s = status.toLowerCase()
  if (['processed', 'succeeded', 'ok', 'accepted', 'completed', 'passed'].includes(s)) return 'success'
  if (['failed', 'dead', 'rejected', 'error'].includes(s)) return 'critical'
  if (['duplicate', 'ignored'].includes(s)) return 'neutral'
  if (['queued', 'received', 'running', 'pending'].includes(s)) return 'info'
  return 'warning'
}

/** Activity log for one connection: webhooks received, tests, syncs and jobs. Refreshes while open. */
export function ActivityDrawer({ connection, onOpenChange }: { connection: ConnectionDto | null; onOpenChange: (open: boolean) => void }) {
  const q = useConnectionActivity(connection?.id ?? null)
  return (
    <Dialog open={!!connection} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>Activity: {connection?.displayName}</DialogTitle>
          <DialogDescription>Latest 100 events, tests and background jobs. Updates every few seconds.</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {q.isLoading ? (
            <ListSkeleton rows={5} />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data?.length ? (
            <EmptyState icon={History} title="No activity yet" description="Events appear here as soon as the provider sends them." />
          ) : (
            <ol className="divide-y divide-line rounded-lg border border-line">
              {q.data.map((a, i) => (
                <li key={`${a.id ?? i}-${a.at}`} className="flex flex-col gap-1 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">{humanize(a.kind)}</Badge>
                    <Badge variant={statusVariant(a.status)}>{humanize(a.status)}</Badge>
                    <time className="ml-auto text-[12px] text-ink-muted" dateTime={a.at}>
                      {formatDateTime(a.at)}
                    </time>
                  </div>
                  <p className="text-sm break-words">{a.summary}</p>
                  {a.detail && <p className="text-[12px] break-words text-ink-muted">{a.detail}</p>}
                </li>
              ))}
            </ol>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
