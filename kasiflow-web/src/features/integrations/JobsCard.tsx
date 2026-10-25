import { RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { ErrorState, ListSkeleton } from '@/components/shared/States'
import { errorMessage } from '@/lib/apiClient'
import { formatDateTime, humanize } from '@/lib/format'
import type { JobStatus } from '@/types/automation'
import { useJobs, useRetryJob } from './api'

const VARIANT: Record<JobStatus, 'success' | 'info' | 'warning' | 'critical'> = {
  succeeded: 'success',
  queued: 'info',
  running: 'info',
  failed: 'warning',
  dead: 'critical',
}

export function JobsCard({ canManage }: { canManage: boolean }) {
  const jobs = useJobs(canManage)
  const retry = useRetryJob()
  if (!canManage) return null
  const items = jobs.data ?? []
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Background jobs</CardTitle>
        <CardDescription>Webhook processing, syncs and refreshes run in the background and retry automatically. Dead jobs stopped retrying and need you.</CardDescription>
      </CardHeader>
      <CardContent className="px-0 pb-0">
        {jobs.isLoading ? (
          <div className="px-5 pb-5">
            <ListSkeleton rows={3} />
          </div>
        ) : jobs.isError ? (
          <div className="px-5 pb-5">
            <ErrorState error={jobs.error} onRetry={() => jobs.refetch()} />
          </div>
        ) : items.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-ink-muted">No background jobs yet.</p>
        ) : (
          <Table>
            <THead>
              <TR>
                <TH>Job</TH>
                <TH>Status</TH>
                <TH>Attempts</TH>
                <TH>Updated</TH>
                <TH>Last error</TH>
                <TH className="text-right">
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {items.slice(0, 30).map((j) => (
                <TR key={j.id}>
                  <TD className="whitespace-nowrap">{humanize(j.jobType)}</TD>
                  <TD>
                    <Badge variant={VARIANT[j.status] ?? 'neutral'}>{humanize(j.status)}</Badge>
                  </TD>
                  <TD className="tabular">
                    {j.attempts}/{j.maxAttempts}
                  </TD>
                  <TD className="whitespace-nowrap text-ink-soft">{formatDateTime(j.updatedAt)}</TD>
                  <TD className="max-w-72 text-[13px] text-ink-muted">
                    <span className="line-clamp-2 break-words">{j.lastError ?? '—'}</span>
                  </TD>
                  <TD className="text-right">
                    {(j.status === 'failed' || j.status === 'dead') && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={retry.isPending && retry.variables === j.id}
                        onClick={() =>
                          retry.mutate(j.id, {
                            onSuccess: () => toast.success('Job queued again'),
                            onError: (e) => toast.error('Could not retry', { description: errorMessage(e) }),
                          })
                        }
                      >
                        <RotateCcw /> Retry
                      </Button>
                    )}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
