import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Ban, SearchX, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAccess } from '@/features/access/useAccess'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Progress } from '@/components/ui/progress'
import { Callout } from '@/components/shared/Callout'
import { Money } from '@/components/shared/Money'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { ReasonDialog } from '@/components/shared/ReasonDialog'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDate, formatDateTime } from '@/lib/format'
import { PaymentDialog } from '@/features/customers/PaymentDialog'
import { PaymentHistory } from '@/features/customers/PaymentHistory'
import { useCancelPayable, usePayable, usePayablePayment } from './api'
import { PayableStatusBadge } from './SuppliersPage'

export function BillDetailPage() {
  const canEdit = useAccess().can('manageFinancials')
  const { id } = useParams()
  const q = usePayable(id)
  const pay = usePayablePayment()
  const cancel = useCancelPayable()
  const [payOpen, setPayOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)

  const back = (
    <Link to="/suppliers" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-forest-800 hover:underline">
      <ArrowLeft className="size-4" aria-hidden /> Suppliers & bills
    </Link>
  )
  if (q.isLoading)
    return (
      <div>
        {back}
        <Skeleton className="h-48" />
      </div>
    )
  if (q.isError || !q.data)
    return (
      <div>
        {back}
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <EmptyState icon={SearchX} title="Bill not found" description="It may belong to another business or the link is wrong." />
        ) : (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        )}
      </div>
    )
  const p = q.data
  const paidPct = p.originalAmountCents > 0 ? (p.paidCents / p.originalAmountCents) * 100 : 0
  const open = p.status === 'open'
  const hasActivePayments = p.payments.some((x) => !x.isVoided)

  return (
    <div className="max-w-4xl">
      {back}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-ink-muted">You owe {p.supplierName}</p>
          <h1 className="font-display text-3xl font-bold tabular">
            <Money cents={p.remainingCents} />
          </h1>
          <p className="mt-1 text-[15px] text-ink-soft">{p.description}</p>
          <div className="mt-2">
            <PayableStatusBadge p={p} />
          </div>
        </div>
        {open && canEdit && (
          <Button onClick={() => setPayOpen(true)}>
            <Wallet /> Record payment
          </Button>
        )}
      </div>

      {p.status === 'cancelled' && (
        <Callout tone="neutral" className="mb-4" title="Cancelled">
          This bill no longer counts as owed or in your forecast.
        </Callout>
      )}

      <div className="grid gap-5 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="mb-5">
              <div className="mb-1.5 flex justify-between text-[13px] text-ink-muted">
                <span>
                  Paid <Money cents={p.paidCents} className="font-semibold text-ink" /> of <Money cents={p.originalAmountCents} />
                </span>
                <span>{Math.round(paidPct)}%</span>
              </div>
              <Progress value={paidPct} label="Share of the bill paid" />
            </div>
            <dl className="grid gap-4 sm:grid-cols-2">
              {[
                ['Supplier', p.supplierName],
                ['Category', p.category],
                ['Bill date', formatDate(p.billDate)],
                ['Due date', formatDate(p.dueDate)],
                ['Reference', p.reference ?? '—'],
                ['Recorded', formatDateTime(p.createdAt)],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="text-[13px] text-ink-muted">{k}</dt>
                  <dd className="text-sm font-medium">{v}</dd>
                </div>
              ))}
              {p.notes && (
                <div className="sm:col-span-2">
                  <dt className="text-[13px] text-ink-muted">Notes</dt>
                  <dd className="text-sm whitespace-pre-wrap">{p.notes}</dd>
                </div>
              )}
            </dl>
          </CardContent>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Payments</CardTitle>
          </CardHeader>
          <CardContent>
            <PaymentHistory payments={p.payments} />
          </CardContent>
        </Card>
      </div>

      {open && canEdit && (
        <div className="mt-6 border-t border-line pt-5">
          <Button variant="ghost" className="text-red-700 hover:text-red-800" disabled={hasActivePayments} onClick={() => setCancelOpen(true)}>
            <Ban /> Cancel bill
          </Button>
          <p className="mt-1 text-[13px] text-ink-muted">
            {hasActivePayments
              ? 'A bill with payments cannot be cancelled. Void the payment transactions first if this bill was a mistake.'
              : 'Use this if the bill was entered by mistake or the supplier cancelled it.'}
          </p>
        </div>
      )}

      <PaymentDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        kind="payable"
        remainingCents={p.remainingCents}
        counterparty={p.supplierName}
        onSubmit={(input) => pay.mutateAsync({ id: p.id, input })}
      />
      <ReasonDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title="Cancel this bill?"
        description="It will be removed from what you owe and from your forecast. The record stays in your history."
        confirmLabel="Cancel bill"
        pending={cancel.isPending}
        onConfirm={(reason) =>
          cancel.mutate(
            { id: p.id, reason },
            {
              onSuccess: () => {
                toast.success('Bill cancelled')
                setCancelOpen(false)
              },
              onError: (err) => toast.error('Could not cancel', { description: errorMessage(err) }),
            },
          )
        }
      />
    </div>
  )
}
