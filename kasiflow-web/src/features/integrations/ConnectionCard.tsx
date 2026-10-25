import { useState } from 'react'
import { Activity, CheckCircle2, Plug, RefreshCw, Unplug, Wrench } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Callout } from '@/components/shared/Callout'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { CopyButton } from '@/components/shared/CopyButton'
import { errorMessage } from '@/lib/apiClient'
import { env } from '@/lib/env'
import { formatDateTime } from '@/lib/format'
import { CONNECTION_STATUS_LABELS, connectionTone, webhookUrl } from '@/lib/automation'
import type { ConnectionDto, ConnectionStatus } from '@/types/automation'
import { useDisconnect, useSyncConnection, useTestConnection } from './api'

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: 'warn' }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-ink-muted">{label}</dt>
      <dd className={`mt-0.5 text-sm font-semibold tabular ${tone === 'warn' ? 'text-amber-800' : ''}`}>{value}</dd>
    </div>
  )
}

export function ConnectionCard({ c, canManage, onActivity }: { c: ConnectionDto; canManage: boolean; onActivity: () => void }) {
  const test = useTestConnection()
  const sync = useSyncConnection()
  const disconnect = useDisconnect()
  const [confirm, setConfirm] = useState(false)
  const tone = connectionTone(c.status, c.health.state)
  const statusLabel = CONNECTION_STATUS_LABELS[c.status as ConnectionStatus] ?? c.status
  const fullWebhook = webhookUrl(env.apiBaseUrl, c.webhookPath)
  const h = c.health

  return (
    <Card className="min-w-0">
      <CardContent className="pt-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="font-sans text-base font-semibold">{c.displayName}</h3>
              <Badge variant={tone}>
                {c.status === 'connected' ? <CheckCircle2 aria-hidden /> : <Wrench aria-hidden />}
                {statusLabel}
              </Badge>
              {c.isSandbox && (
                <Badge variant="forest" className="border-ochre bg-ochre text-forest-950">
                  SANDBOX
                </Badge>
              )}
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              <span className="sr-only">Health: </span>
              {h.label}
            </p>
            {c.credentialRef && <p className="mt-0.5 text-[13px] text-ink-muted">Credential name on the server: <code>{c.credentialRef}</code></p>}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onActivity}>
              <Activity /> Activity
            </Button>
            {canManage && (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  loading={test.isPending}
                  onClick={() =>
                    test.mutate(c.id, {
                      onSuccess: (r) =>
                        r.ok ? toast.success('Connection test passed') : toast.warning('Connection not ready', { description: [r.error, r.hint].filter(Boolean).join(' ') }),
                      onError: (e) => toast.error('Test failed', { description: errorMessage(e) }),
                    })
                  }
                >
                  <Plug /> Test connection
                </Button>
                {c.providerKey === 'snapscan' && (
                  <Button
                    variant="outline"
                    size="sm"
                    loading={sync.isPending}
                    disabled={c.status !== 'connected'}
                    title={c.status !== 'connected' ? 'Run a successful connection test first' : undefined}
                    onClick={() =>
                      sync.mutate(c.id, {
                        onSuccess: () => toast.success('Sync queued', { description: 'New payments appear here once the background worker has fetched them.' }),
                        onError: (e) => toast.error('Could not sync', { description: errorMessage(e) }),
                      })
                    }
                  >
                    <RefreshCw /> Sync now
                  </Button>
                )}
                <Button variant="ghost" size="sm" className="text-red-700 hover:text-red-800" onClick={() => setConfirm(true)}>
                  <Unplug /> Disconnect
                </Button>
              </>
            )}
          </div>
        </div>

        {c.lastError && (
          <Callout tone={c.status === 'connected' ? 'warning' : 'critical'} className="mt-4" title={c.lastError}>
            {c.lastErrorHint ?? 'Check the connection and try the test again.'}
          </Callout>
        )}

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Events (24 h)" value={h.eventsLast24h} />
          <Stat label="Duplicates ignored (7 d)" value={h.duplicateEvents} />
          <Stat label="Failed events" value={h.failedEvents} tone={h.failedEvents > 0 ? 'warn' : undefined} />
          <Stat label="Jobs waiting" value={h.pendingJobs} />
          <Stat label="Dead jobs" value={h.deadJobs} tone={h.deadJobs > 0 ? 'warn' : undefined} />
          <Stat label="Last event" value={h.lastEventAt ? formatDateTime(h.lastEventAt) : '—'} />
          <Stat
            label="Last test"
            value={c.lastTestAt ? `${formatDateTime(c.lastTestAt)} · ${c.lastTestOk ? 'passed' : 'failed'}` : 'Never'}
            tone={c.lastTestOk === false ? 'warn' : undefined}
          />
          <Stat label="Last sync" value={c.lastSyncAt ? formatDateTime(c.lastSyncAt) : '—'} />
          <Stat label="Last success" value={c.lastSuccessAt ? formatDateTime(c.lastSuccessAt) : '—'} />
        </dl>

        <div className="mt-4 rounded-md border border-line bg-paper p-3">
          <p className="text-[12px] font-medium text-ink-muted">Webhook URL {c.isSandbox ? '(used by the simulator)' : '(give this to the provider)'}</p>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
            <code className="min-w-0 flex-1 text-[13px] break-all">{fullWebhook}</code>
            <CopyButton text={fullWebhook} label="Copy URL" className="shrink-0 self-start" />
          </div>
        </div>
      </CardContent>

      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Disconnect ${c.displayName}?`}
        description="New events from this provider will be refused. Payments and sales already recorded stay on record. You can connect again later."
        confirmLabel="Disconnect"
        destructive
        pending={disconnect.isPending}
        onConfirm={() =>
          disconnect
            .mutateAsync(c.id)
            .then(() => {
              toast.success('Disconnected')
              setConfirm(false)
            })
            .catch((e: unknown) => toast.error('Could not disconnect', { description: errorMessage(e) }))
        }
      />
    </Card>
  )
}
