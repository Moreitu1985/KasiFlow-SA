import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CheckCheck, Landmark, Scale } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { NativeSelect } from '@/components/ui/input'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Callout } from '@/components/shared/Callout'
import { KpiCard } from '@/components/shared/KpiCard'
import { Money } from '@/components/shared/Money'
import { RoleHeader } from '@/features/access/RoleHeader'
import { Pagination } from '@/components/shared/Pagination'
import { CardsSkeleton, EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { formatDate, formatDateTime, humanize } from '@/lib/format'
import { PAYMENT_STATUS_LABELS, RECON_STATUS_LABELS } from '@/lib/automation'
import { useAccess } from '@/features/access/useAccess'
import { useProviderPayments, useSettlements } from '@/features/integrations/api'
import type { ProviderPaymentStatus, ReconciliationStatus } from '@/types/automation'
import { useReconciliationQueue, useReconciliationSummary } from './api'
import { QueueItem } from './QueueItem'

const QUEUE_TABS: { key: ReconciliationStatus; label: string }[] = [
  { key: 'needs_review', label: 'Needs review' },
  { key: 'unmatched', label: 'Unmatched' },
  { key: 'auto_matched', label: 'Auto-matched' },
  { key: 'matched', label: 'Matched' },
  { key: 'created_sale', label: 'Created sales' },
  { key: 'ignored', label: 'Ignored' },
]

function Queue({ status, canManage }: { status: ReconciliationStatus; canManage: boolean }) {
  const q = useReconciliationQueue(status)
  if (q.isLoading) return <ListSkeleton rows={3} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data?.length)
    return (
      <EmptyState
        icon={CheckCheck}
        title={status === 'needs_review' ? 'Nothing needs review' : `No ${RECON_STATUS_LABELS[status].toLowerCase()} payments`}
        description={status === 'needs_review' ? 'New provider payments that might match a recorded sale appear here automatically.' : undefined}
      />
    )
  return (
    <div className="grid min-w-0 gap-4">
      {q.data.map((item) => (
        <QueueItem key={item.payment.id} item={item} canManage={canManage} />
      ))}
    </div>
  )
}

function Settlements() {
  const q = useSettlements()
  if (q.isLoading) return <ListSkeleton rows={3} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  if (!q.data?.length) return <EmptyState icon={Landmark} title="No settlements yet" description="When a provider pays money out to your bank, the payout appears here with its gross, fees and net amount." />
  return (
    <Card className="min-w-0 overflow-hidden">
      <Table>
        <THead>
          <TR>
            <TH>Paid out on</TH>
            <TH>Settlement</TH>
            <TH className="text-right">Payments</TH>
            <TH className="text-right">Gross</TH>
            <TH className="text-right">Fees</TH>
            <TH className="text-right">Net to bank</TH>
          </TR>
        </THead>
        <TBody>
          {q.data.map((s) => (
            <TR key={s.id}>
              <TD className="whitespace-nowrap">{formatDate(s.settledOn)}</TD>
              <TD>
                <span className="text-[13px] break-all">{s.externalSettlementId}</span>
                {s.environment === 'sandbox' && (
                  <Badge variant="forest" className="ml-2 border-ochre bg-ochre text-forest-950">
                    Sandbox
                  </Badge>
                )}
              </TD>
              <TD className="text-right tabular">{s.paymentCount}</TD>
              <TD className="text-right">
                <Money cents={s.grossCents} />
              </TD>
              <TD className="text-right">
                {s.feeCents === null ? <span className="text-[13px] text-ink-muted">Fees not reported by provider</span> : <Money cents={s.feeCents} />}
              </TD>
              <TD className="text-right font-semibold">
                {s.netCents === null ? <span className="text-[13px] font-normal text-ink-muted">Not reported</span> : <Money cents={s.netCents} />}
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </Card>
  )
}

export function ProviderPaymentsTable() {
  const [status, setStatus] = useState<ProviderPaymentStatus | ''>('')
  const [page, setPage] = useState(1)
  const q = useProviderPayments({ status: status || undefined, page })
  return (
    <div className="space-y-3">
      <div className="max-w-xs">
        <Label htmlFor="pp-status">Payment status</Label>
        <NativeSelect
          id="pp-status"
          className="mt-1.5"
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as ProviderPaymentStatus | '')
            setPage(1)
          }}
        >
          <option value="">All statuses</option>
          {(Object.keys(PAYMENT_STATUS_LABELS) as ProviderPaymentStatus[]).map((k) => (
            <option key={k} value={k}>
              {PAYMENT_STATUS_LABELS[k]}
            </option>
          ))}
        </NativeSelect>
      </div>
      {q.isLoading ? (
        <ListSkeleton rows={5} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.items.length ? (
        <EmptyState icon={Scale} title="No provider payments" description="Payments from connected providers appear here once they are received." />
      ) : (
        <>
          <Card className="min-w-0 overflow-hidden">
            <Table>
              <THead>
                <TR>
                  <TH>When</TH>
                  <TH>Provider</TH>
                  <TH>Kind / method</TH>
                  <TH>Status</TH>
                  <TH>Reconciliation</TH>
                  <TH>Reference</TH>
                  <TH className="text-right">Gross</TH>
                </TR>
              </THead>
              <TBody>
                {q.data.items.map((p) => (
                  <TR key={p.id}>
                    <TD className="whitespace-nowrap text-ink-soft">{formatDateTime(p.occurredAt)}</TD>
                    <TD>
                      <span className="block">{p.connectionName}</span>
                      <span className="text-[12px] text-ink-muted">{p.sourceLabel}</span>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {humanize(p.kind)} · {humanize(p.method)}
                    </TD>
                    <TD>
                      <Badge variant={p.status === 'completed' ? 'success' : p.status === 'pending' ? 'warning' : 'neutral'}>{PAYMENT_STATUS_LABELS[p.status] ?? p.status}</Badge>
                    </TD>
                    <TD>
                      {p.transactionId ? (
                        <Link to={`/transactions/${p.transactionId}`} className="text-[13px] font-medium text-forest-800 hover:underline">
                          {RECON_STATUS_LABELS[p.reconciliationStatus] ?? p.reconciliationStatus}
                        </Link>
                      ) : (
                        <span className="text-[13px]">{RECON_STATUS_LABELS[p.reconciliationStatus] ?? p.reconciliationStatus}</span>
                      )}
                    </TD>
                    <TD className="text-[13px] break-all text-ink-muted">{p.merchantReference ?? '—'}</TD>
                    <TD className="text-right">
                      <Money cents={p.kind === 'refund' ? -p.grossCents : p.grossCents} tone="auto" className="font-semibold" />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>
          <Pagination page={q.data.page} totalPages={q.data.totalPages} totalCount={q.data.totalCount} onPage={setPage} />
        </>
      )}
    </div>
  )
}

export function ReconciliationPage() {
  const { can } = useAccess()
  const canManage = can('manageReconciliation')
  const summary = useReconciliationSummary()
  const [tab, setTab] = useState<string>('needs_review')
  const s = summary.data

  return (
    <div className="space-y-6">
      <RoleHeader
        title="Reconciliation"
        description="Compare payments confirmed by providers with the sales recorded in KasiFlow, so nothing is counted twice or missed."
       
        actions={
          <Button asChild variant="outline">
            <Link to="/integrations">Integrations</Link>
          </Button>
        }
      />

      <Callout tone="info" title="How matching works">
        Pending payments are not income until the provider completes them. A payment is only matched automatically when its reference matches exactly one
        sale with the same amount; anything less certain waits here for you. Amounts are never changed to force a match.
      </Callout>

      {summary.isLoading ? (
        <CardsSkeleton count={4} />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : s ? (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <KpiCard label="Needs review" value={s.needsReview} tone={s.needsReview > 0 ? 'warning' : 'default'} definition="Completed payments that may match a recorded sale. A person must decide." />
          <KpiCard
            label="Pending amount"
            value={<Money cents={s.pendingCents} />}
            note={`${s.pendingCount} pending payment(s) — not income yet`}
            definition="Payments the provider has not completed. They are never counted as income until they complete."
          />
          <KpiCard
            label="Unsettled"
            value={<Money cents={s.unsettledCents} />}
            note={`${s.settlementsCount} settlement(s) so far`}
            definition="Completed payments the provider has not yet paid out to your bank."
          />
          <KpiCard label="Unmatched" value={s.unmatched} definition="Completed payments with no matching sale and no decision yet." />
          <KpiCard label="Auto-matched" value={s.autoMatched} definition="Matched automatically because the reference and amount matched exactly one sale." />
          <KpiCard label="Matched by a person" value={s.matched} definition="Matched to a recorded sale by someone in your business." />
          <KpiCard label="Created sales" value={s.createdSales} definition="Payments that became new sales because nobody had recorded them." />
          <KpiCard label="Ignored" value={s.ignored} definition="Payments marked as not a sale, with a reason." />
        </div>
      ) : null}

      {!canManage && (
        <Callout tone="neutral" title="View only">
          Your role can look at reconciliation but not make decisions.
        </Callout>
      )}

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Reconciliation views">
          {QUEUE_TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>
              {t.label}
              {t.key === 'needs_review' && s && s.needsReview > 0 && <Badge variant="warning">{s.needsReview}</Badge>}
            </TabsTrigger>
          ))}
          <TabsTrigger value="settlements">Settlements</TabsTrigger>
          <TabsTrigger value="payments">Provider payments</TabsTrigger>
        </TabsList>
        {QUEUE_TABS.map((t) => (
          <TabsContent key={t.key} value={t.key}>
            {tab === t.key && <Queue status={t.key} canManage={canManage} />}
          </TabsContent>
        ))}
        <TabsContent value="settlements">
          <p className="mb-3 text-sm text-ink-soft">Gross, fees and net are shown separately. KasiFlow never invents fees a provider did not report.</p>
          {tab === 'settlements' && <Settlements />}
        </TabsContent>
        <TabsContent value="payments">{tab === 'payments' && <ProviderPaymentsTable />}</TabsContent>
      </Tabs>
    </div>
  )
}
