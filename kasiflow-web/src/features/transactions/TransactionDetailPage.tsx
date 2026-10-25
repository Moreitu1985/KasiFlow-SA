import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Ban, Link2, Pencil, SearchX } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Callout } from '@/components/shared/Callout'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { ReasonDialog } from '@/components/shared/ReasonDialog'
import { OriginBadge, TxnStatusBadge } from '@/components/shared/Badges'
import { isProviderCreated, PAYMENT_STATUS_LABELS } from '@/lib/automation'
import { useAccess } from '@/features/access/useAccess'
import type { ProviderPaymentStatus } from '@/types/automation'
import { Badge } from '@/components/ui/badge'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDate, formatDateTime, formatZAR } from '@/lib/format'
import { PAYMENT_METHODS, PAYMENT_STATUS } from '@/lib/labels'
import { useTransaction, useVoidTransaction } from './api'
import { TransactionFormDialog } from './TransactionFormDialog'
import { TxnIcon } from './TransactionRow'

export function TransactionDetailPage() {
  const { id } = useParams()
  const tx = useTransaction(id)
  const voidTx = useVoidTransaction()
  const [editOpen, setEditOpen] = useState(false)
  const [voidOpen, setVoidOpen] = useState(false)
  const { can } = useAccess()

  const back = (
    <Link to="/transactions" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-forest-800 hover:underline">
      <ArrowLeft className="size-4" aria-hidden /> All transactions
    </Link>
  )

  if (tx.isLoading)
    return (
      <div>
        {back}
        <Skeleton className="h-40 w-full" />
      </div>
    )
  if (tx.isError)
    return (
      <div>
        {back}
        {tx.error instanceof ApiError && tx.error.status === 404 ? (
          <EmptyState icon={SearchX} title="Transaction not found" description="It may belong to another business or the link is wrong." />
        ) : (
          <ErrorState error={tx.error} onRetry={() => tx.refetch()} />
        )}
      </div>
    )
  const t = tx.data
  if (!t) return null
  const linked = t.source !== 'manual'
  const linkTo = t.receivableId ? `/debts/${t.receivableId}` : t.payableId ? `/suppliers/bills/${t.payableId}` : null
  const voided = t.status === 'voided'
  const fromProvider = isProviderCreated(t.origin)
  const matchedToProvider = !fromProvider && !!t.providerPaymentId
  const canEdit = !linked && !fromProvider && !matchedToProvider && can('manageFinancials')
  const canVoid = !fromProvider && !matchedToProvider && can('voidTransactions')

  const rows: [string, React.ReactNode][] = [
    ['Type', t.type === 'income' ? 'Income' : 'Expense'],
    ['Category', t.category],
    ['Date', formatDate(t.transactionDate)],
    ['Payment method', PAYMENT_METHODS[t.paymentMethod]],
    ['Payment status', PAYMENT_STATUS[t.paymentStatus]],
    ['Reference', t.reference ?? '—'],
    ['Source', <OriginBadge origin={t.origin} />],
    ...(t.branchName ? ([['Branch', t.branchName]] as [string, React.ReactNode][]) : []),
    ...(t.shiftId ? ([['Shift', 'Recorded during a till shift']] as [string, React.ReactNode][]) : []),
    ...(t.providerKey
      ? ([
          ['Payment provider', t.providerKey === 'sandbox' ? 'KasiFlow sandbox (simulated)' : t.providerKey === 'snapscan' ? 'SnapScan' : t.providerKey],
          ['Provider status', t.providerStatus ? (PAYMENT_STATUS_LABELS[t.providerStatus as ProviderPaymentStatus] ?? t.providerStatus) : '—'],
        ] as [string, React.ReactNode][])
      : []),
    ...(t.counterpartyName ? ([[t.receivableId ? 'Customer' : 'Supplier', t.counterpartyName]] as [string, React.ReactNode][]) : []),
    ['Recorded', formatDateTime(t.createdAt)],
    ['Last changed', formatDateTime(t.updatedAt)],
  ]

  return (
    <div className="max-w-3xl">
      {back}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <TxnIcon type={t.type} />
          <div>
            <h1 className="text-2xl font-bold">{t.description}</h1>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <TxnStatusBadge status={t.status} />
              <OriginBadge origin={t.origin} />
              {linked && (
                <Badge variant="outline">
                  <Link2 aria-hidden /> {t.source === 'receivable_payment' ? 'Debt payment' : 'Bill payment'}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <p className={`font-display text-3xl font-semibold tabular ${voided ? 'text-ink-muted line-through' : t.type === 'income' ? 'text-emerald-800' : ''}`}>
          {t.type === 'income' ? '+' : '-'}
          {formatZAR(t.amountCents)}
        </p>
      </div>

      {voided && (
        <Callout tone="neutral" className="mb-4" title={`Voided ${formatDateTime(t.voidedAt)}`}>
          Reason: {t.voidReason ?? '—'}. This entry no longer counts in totals but stays on record.
        </Callout>
      )}
      {linked && linkTo && (
        <Callout
          tone="info"
          className="mb-4"
          title="Created from a payment"
          action={
            <Button asChild variant="outline" size="sm">
              <Link to={linkTo}>{t.receivableId ? 'Open the debt' : 'Open the bill'}</Link>
            </Button>
          }
        >
          This transaction was created when a {t.receivableId ? 'customer debt' : 'supplier bill'} payment was recorded, so it can't be edited here. Voiding it re-opens the {t.receivableId ? 'debt' : 'bill'}.
        </Callout>
      )}

      {(fromProvider || matchedToProvider) && !voided && (
        <Callout
          tone="info"
          className="mb-4"
          title={fromProvider ? 'Created from a provider payment' : 'Matched to a confirmed provider payment'}
          action={
            can('manageReconciliation', 'viewIntegrations') ? (
              <Button asChild variant="outline" size="sm">
                <Link to="/reconciliation">Open Reconciliation</Link>
              </Button>
            ) : undefined
          }
        >
          {fromProvider
            ? 'This record comes from a payment provider or POS, so it cannot be edited or voided here. If it is wrong, unmatch it in Reconciliation or refund it through the provider.'
            : 'The provider confirmed this amount. To change or void the sale, unmatch it in Reconciliation first.'}
          {t.origin === 'demo_simulation' && ' It is simulated demo data, not real money.'}
        </Callout>
      )}

      <Card>
        <CardContent className="pt-5">
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k}>
                <dt className="text-[13px] text-ink-muted">{k}</dt>
                <dd className="mt-0.5 text-sm font-medium">{v}</dd>
              </div>
            ))}
            {t.notes && (
              <div className="sm:col-span-2">
                <dt className="text-[13px] text-ink-muted">Notes</dt>
                <dd className="mt-0.5 text-sm whitespace-pre-wrap">{t.notes}</dd>
              </div>
            )}
          </dl>
        </CardContent>
      </Card>

      {!voided && (canEdit || canVoid) && (
        <div className="mt-5 flex flex-wrap gap-2">
          {canEdit && (
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit
            </Button>
          )}
          {canVoid && (
            <Button variant="outline" className="text-red-700 hover:text-red-800" onClick={() => setVoidOpen(true)}>
              <Ban /> Void transaction
            </Button>
          )}
        </div>
      )}

      <TransactionFormDialog open={editOpen} onOpenChange={setEditOpen} transaction={t} />
      <ReasonDialog
        open={voidOpen}
        onOpenChange={setVoidOpen}
        title="Void this transaction?"
        description={
          <>
            Voiding removes it from your balance, reports and forecast, but keeps it on record with your reason so your history stays honest.
            {linked && ' The linked debt or bill will be re-opened by this amount.'}
          </>
        }
        reasonLabel="Why are you voiding it?"
        confirmLabel="Void transaction"
        pending={voidTx.isPending}
        onConfirm={(reason) =>
          voidTx.mutate(
            { id: t.id, reason },
            {
              onSuccess: () => {
                toast.success('Transaction voided')
                setVoidOpen(false)
              },
              onError: (err) => toast.error('Could not void', { description: errorMessage(err) }),
            },
          )
        }
      />
    </div>
  )
}
