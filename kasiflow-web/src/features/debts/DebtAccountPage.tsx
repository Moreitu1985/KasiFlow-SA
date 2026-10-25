import { useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, Ban, FileWarning, HandCoins, MessageCircle, NotebookPen, Scale, SearchX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Callout } from '@/components/shared/Callout'
import { Money } from '@/components/shared/Money'
import { ReasonDialog } from '@/components/shared/ReasonDialog'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { DebtStatusBadge } from '@/components/shared/StatusBadges'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDate, formatDateTime } from '@/lib/format'
import { CHARGE_STATUS_LABELS, isNotAddedLine, REMINDER_CHANNELS, REMINDER_OUTCOMES } from '@/lib/barbershop'
import { entries } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { useAccess } from '@/features/access/useAccess'
import { useBusiness } from '@/features/business/BusinessProvider'
import { useCustomer, useReceivablePayment, useWriteOffReceivable } from '@/features/customers/api'
import { PaymentDialog } from '@/features/customers/PaymentDialog'
import { ReminderDialog, buildReminder } from '@/features/customers/ReminderDialog'
import type { DebtChargeDto, ReminderChannel, ReminderOutcome } from '@/types/barbershop'
import { useDebtAccount, useDebtAction } from './api'

/** Old links (/customers/debts/:id) keep working. */
export function LegacyDebtRedirect() {
  const { id } = useParams()
  return <Navigate to={`/debts/${id ?? ''}`} replace />
}

function LogReminderDialog({ id, open, onOpenChange }: { id: string; open: boolean; onOpenChange: (o: boolean) => void }) {
  const act = useDebtAction()
  const [channel, setChannel] = useState<ReminderChannel>('whatsapp')
  const [outcome, setOutcome] = useState<ReminderOutcome>('sent')
  const [note, setNote] = useState('')
  useEffect(() => {
    if (open) {
      setChannel('whatsapp')
      setOutcome('sent')
      setNote('')
    }
  }, [open])
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Log a reminder</DialogTitle>
          <DialogDescription>Keep a record of each follow-up. Be polite and private — never shame a customer publicly.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="rm-ch" label="How">
              <NativeSelect value={channel} onChange={(e) => setChannel(e.target.value as ReminderChannel)}>
                {entries(REMINDER_CHANNELS).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="rm-out" label="What happened">
              <NativeSelect value={outcome} onChange={(e) => setOutcome(e.target.value as ReminderOutcome)}>
                {entries(REMINDER_OUTCOMES).map(([k, l]) => (
                  <option key={k} value={k}>
                    {l}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
          <Field id="rm-note" label="Note" optional>
            <Input maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Will pay R50 on Friday" />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            loading={act.isPending}
            onClick={() =>
              act.mutate(
                { id, m: { kind: 'reminder', input: { channel, outcome, note: note.trim() || null } } },
                {
                  onSuccess: () => {
                    toast.success('Reminder logged')
                    onOpenChange(false)
                  },
                  onError: (e) => toast.error('Could not log the reminder', { description: errorMessage(e) }),
                },
              )
            }
          >
            Save reminder
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function DebtAccountPage() {
  const { id } = useParams()
  const { can } = useAccess()
  const q = useDebtAccount(id)
  const act = useDebtAction()
  const pay = useReceivablePayment()
  const writeOff = useWriteOffReceivable()
  const { activeBusiness } = useBusiness()
  const customer = useCustomer(can('viewFinancials') ? q.data?.debt.customerId : undefined)
  const [dialog, setDialog] = useState<'pay' | 'log' | 'whatsapp' | 'dispute' | 'resolve' | 'writeoff' | null>(null)
  const [charge, setCharge] = useState<{ c: DebtChargeDto; decision: 'waive' | 'reverse' } | null>(null)
  const canPay = can('manageFinancials', 'recordDebtPayments')

  const back = (
    <Link to="/debts" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-forest-800 hover:underline">
      <ArrowLeft className="size-4" aria-hidden /> Debts
    </Link>
  )
  if (q.isLoading)
    return (
      <div>
        {back}
        <Skeleton className="h-56" />
      </div>
    )
  if (q.isError || !q.data)
    return (
      <div>
        {back}
        {q.error instanceof ApiError && q.error.status === 404 ? (
          <EmptyState icon={SearchX} title="Debt not found" description="It may belong to another business or the link is wrong." />
        ) : (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        )}
      </div>
    )

  const a = q.data
  const d = a.debt
  const b = a.balance
  const open = d.status === 'open'

  const runReason = (kind: 'dispute' | 'resolve-dispute', reason: string, ok: string) =>
    act.mutate(
      { id: d.id, m: { kind, reason } },
      {
        onSuccess: () => {
          toast.success(ok)
          setDialog(null)
        },
        onError: (e) => toast.error('Could not update', { description: errorMessage(e) }),
      },
    )

  return (
    <div className="max-w-5xl">
      {back}
      <div className="mb-5 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="text-sm text-ink-muted">{d.customerName} owes</p>
          <h1 className="font-display text-3xl font-bold tabular">
            <Money cents={b.totalOutstandingCents} />
          </h1>
          <p className="mt-1 text-[15px] text-ink-soft">{d.description}</p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px] text-ink-muted">
            <DebtStatusBadge status={d.debtStatus ?? 'outstanding'} label={a.statusLabel} />
            {d.isOverdue && open && <Badge variant="critical">{d.daysOverdue} days overdue</Badge>}
            <span>Due {d.dueDate ? formatDate(d.dueDate) : '— no due date'}</span>
            {d.reference && <span className="font-mono">Ref {d.reference}</span>}
          </div>
        </div>
        {open && (
          <div className="flex flex-wrap gap-2">
            {canPay && (
              <Button size="lg" className="h-11" onClick={() => setDialog('pay')}>
                <HandCoins /> Record payment
              </Button>
            )}
            {canPay && (
              <Button variant="outline" size="lg" className="h-11" disabled={a.remindersPaused} onClick={() => setDialog('log')}>
                <NotebookPen /> Log reminder
              </Button>
            )}
            {can('viewFinancials') && !a.remindersPaused && (
              <Button variant="outline" size="lg" className="h-11" onClick={() => setDialog('whatsapp')}>
                <MessageCircle /> WhatsApp text
              </Button>
            )}
          </div>
        )}
      </div>

      {d.disputed && (
        <Callout
          tone="warning"
          className="mb-4"
          title="Disputed"
          action={
            canPay && (
              <Button size="sm" variant="outline" onClick={() => setDialog('resolve')}>
                Resolve dispute
              </Button>
            )
          }
        >
          The customer disputes this debt. Reminders and late charges are paused until it is resolved.
        </Callout>
      )}
      {a.remindersPaused && !d.disputed && a.remindersPausedReason && (
        <Callout tone="neutral" className="mb-4">
          {a.remindersPausedReason}
        </Callout>
      )}

      <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-5">
        <div className="min-w-0 space-y-5 lg:col-span-3">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Balance</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <dl className="space-y-1.5 text-sm">
                {(
                  [
                    ['Original amount', b.originalPrincipalCents, ''],
                    ['Paid', -b.paidCents, ''],
                    ...(b.writtenOffCents > 0 ? ([['Written off', -b.writtenOffCents, '']] as const) : []),
                    ['Principal outstanding', b.principalOutstandingCents, 'font-semibold'],
                    ...(b.appliedChargesCents > 0 ? ([['Late charges applied', b.appliedChargesCents, ''], ['Charges outstanding', b.chargesOutstandingCents, '']] as const) : []),
                  ] as const
                ).map(([label, cents, cls]) => (
                  <div key={label} className={cn('flex justify-between gap-3', cls)}>
                    <dt className={cls ? '' : 'text-ink-muted'}>{label}</dt>
                    <dd>
                      <Money cents={cents} />
                    </dd>
                  </div>
                ))}
                <div className="flex justify-between gap-3 border-t border-line pt-1.5 text-base font-semibold">
                  <dt>Total owed</dt>
                  <dd>
                    <Money cents={b.totalOutstandingCents} />
                  </dd>
                </div>
                {b.proposedChargesCents > 0 && (
                  <div className="flex justify-between gap-3 text-ink-muted">
                    <dt>Proposed charge — not added</dt>
                    <dd className="line-through decoration-1">
                      <Money cents={b.proposedChargesCents} />
                    </dd>
                  </div>
                )}
              </dl>
              <p className="rounded-md bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink-soft">{b.explanation}</p>
            </CardContent>
          </Card>

          <Card className="min-w-0 overflow-hidden">
            <CardHeader>
              <CardTitle>Statement of account</CardTitle>
              <CardDescription>Every amount in date order. Proposed charges are listed but never change the balance.</CardDescription>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>What</TH>
                  <TH className="text-right">Amount</TH>
                  <TH className="text-right">Balance</TH>
                </TR>
              </THead>
              <TBody>
                {a.statement.map((l, i) => {
                  const notAdded = isNotAddedLine(l.kind)
                  return (
                    <TR key={i} className={notAdded ? 'bg-paper/70 text-ink-muted' : undefined}>
                      <TD className="px-2 text-[12px] sm:px-4 sm:text-[13px]">{formatDate(l.at)}</TD>
                      <TD className="px-2 text-[13px] sm:px-4">
                        <span className="font-medium">{l.description}</span>
                        {l.kind === 'charge_proposed' && (
                          <Badge variant="warning" className="ml-1.5">
                            Not added
                          </Badge>
                        )}
                        {l.note && <span className="block text-[12px] text-ink-muted">{l.note}</span>}
                      </TD>
                      <TD className={cn('text-right whitespace-nowrap', notAdded && 'line-through decoration-1')}>
                        {l.amountCents == null ? '—' : (
                          <>
                            {l.kind === 'payment' || l.kind === 'write_off' ? '−' : ''}
                            <Money cents={l.amountCents} />
                          </>
                        )}
                      </TD>
                      <TD className="text-right whitespace-nowrap">{l.balanceAfterCents == null ? '—' : <Money cents={l.balanceAfterCents} />}</TD>
                    </TR>
                  )
                })}
              </TBody>
            </Table>
          </Card>
        </div>

        <div className="min-w-0 space-y-5 lg:col-span-2">
          <Card className="min-w-0">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Scale className="size-5 text-forest-800" aria-hidden /> Late charges
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {a.chargeTermsSnapshot ? (
                <div className="rounded-md bg-paper px-3 py-2 text-[13px]">
                  <p className="font-semibold">Terms shown to the customer{a.chargeTermsDisclosedAt && ` on ${formatDateTime(a.chargeTermsDisclosedAt)}`}</p>
                  <p className="mt-0.5 whitespace-pre-wrap text-ink-soft">{a.chargeTermsSnapshot}</p>
                </div>
              ) : (
                <p className="flex gap-2 text-[13px] text-ink-muted">
                  <FileWarning className="mt-0.5 size-4 shrink-0" aria-hidden />
                  No late-charge terms were shown for this debt, so a late charge can only ever be proposed, never added.
                </p>
              )}
              {a.charges.length === 0 ? (
                <p className="text-sm text-ink-muted">No charges.</p>
              ) : (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {a.charges.map((c) => (
                    <li key={c.id} className="space-y-1.5 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <Badge variant={c.status === 'applied' ? 'critical' : c.status === 'proposed' ? 'warning' : 'neutral'}>{CHARGE_STATUS_LABELS[c.status] ?? c.status}</Badge>
                        <Money cents={c.amountCents} className={cn('font-semibold', c.status !== 'applied' && 'text-ink-muted line-through decoration-1')} />
                      </div>
                      <p className="text-[12px] text-ink-muted">{c.basis}</p>
                      {c.decisionReason && (
                        <p className="text-[12px]">
                          Decision: {c.decisionReason} {c.decidedAt && <span className="text-ink-muted">({formatDateTime(c.decidedAt)})</span>}
                        </p>
                      )}
                      {can('manageFinancials') && (c.status === 'proposed' || c.status === 'applied') && (
                        <div className="flex gap-2">
                          <Button size="sm" variant="outline" onClick={() => setCharge({ c, decision: 'waive' })}>
                            Waive
                          </Button>
                          {c.status === 'applied' && (
                            <Button size="sm" variant="ghost" onClick={() => setCharge({ c, decision: 'reverse' })}>
                              Reverse (charged in error)
                            </Button>
                          )}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card className="min-w-0">
            <CardHeader>
              <CardTitle>Reminders</CardTitle>
            </CardHeader>
            <CardContent>
              {a.reminders.length === 0 ? (
                <p className="text-sm text-ink-muted">No reminders logged.</p>
              ) : (
                <ul className="space-y-2">
                  {a.reminders.map((r) => (
                    <li key={r.id} className="text-sm">
                      <span className="font-medium">{REMINDER_CHANNELS[r.channel] ?? r.channel}</span> · {REMINDER_OUTCOMES[r.outcome] ?? r.outcome}
                      <span className="block text-[12px] text-ink-muted">{formatDateTime(r.at)}</span>
                      {r.note && <span className="block text-[13px] text-ink-soft">{r.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {open && canPay && !d.disputed && (
            <div className="rounded-lg border border-line bg-surface p-4">
              <p className="text-sm font-semibold">Customer disagrees?</p>
              <p className="mt-0.5 text-[13px] text-ink-muted">Mark the debt as disputed. Reminders and charges pause until you resolve it.</p>
              <Button size="sm" variant="outline" className="mt-2" onClick={() => setDialog('dispute')}>
                Mark as disputed
              </Button>
            </div>
          )}
          {open && can('manageFinancials') && (
            <div className="border-t border-line pt-4">
              <Button variant="ghost" className="text-red-700 hover:text-red-800" onClick={() => setDialog('writeoff')}>
                <Ban /> Write off remaining amount
              </Button>
              <p className="mt-1 text-[13px] text-ink-muted">Only if you have decided the customer will not pay. It keeps the history.</p>
            </div>
          )}
        </div>
      </div>

      <PaymentDialog
        open={dialog === 'pay'}
        onOpenChange={(o) => setDialog(o ? 'pay' : null)}
        kind="receivable"
        remainingCents={b.totalOutstandingCents}
        counterparty={d.customerName}
        onSubmit={(input) => pay.mutateAsync({ id: d.id, input })}
      />
      <LogReminderDialog id={d.id} open={dialog === 'log'} onOpenChange={(o) => setDialog(o ? 'log' : null)} />
      <ReminderDialog
        open={dialog === 'whatsapp'}
        onOpenChange={(o) => setDialog(o ? 'whatsapp' : null)}
        phone={customer.data?.phone ?? null}
        initialText={buildReminder({
          name: d.customerName,
          business: activeBusiness?.name ?? 'us',
          amountCents: b.totalOutstandingCents,
          description: d.description,
          dueDate: d.dueDate,
        })}
      />
      <ReasonDialog
        open={dialog === 'dispute'}
        onOpenChange={(o) => setDialog(o ? 'dispute' : null)}
        title="Mark this debt as disputed?"
        description="Write down what the customer says. Reminders and late charges pause until the dispute is resolved."
        confirmLabel="Mark as disputed"
        reasonLabel="What the customer disputes"
        pending={act.isPending}
        onConfirm={(r) => runReason('dispute', r, 'Marked as disputed')}
      />
      <ReasonDialog
        open={dialog === 'resolve'}
        onOpenChange={(o) => setDialog(o ? 'resolve' : null)}
        title="Resolve the dispute?"
        description="Say how it was resolved. Reminders can be logged again afterwards."
        confirmLabel="Resolve dispute"
        reasonLabel="How it was resolved"
        pending={act.isPending}
        onConfirm={(r) => runReason('resolve-dispute', r, 'Dispute resolved')}
      />
      <ReasonDialog
        open={!!charge}
        onOpenChange={(o) => !o && setCharge(null)}
        title={charge?.decision === 'reverse' ? 'Reverse this charge?' : 'Waive this charge?'}
        description={
          charge?.decision === 'reverse'
            ? 'Use this if the charge should never have been added. The decision and your reason are logged.'
            : 'The customer will not be asked to pay this charge. The decision and your reason are logged.'
        }
        confirmLabel={charge?.decision === 'reverse' ? 'Reverse charge' : 'Waive charge'}
        pending={act.isPending}
        onConfirm={(reason) =>
          charge &&
          act.mutate(
            { id: d.id, m: { kind: 'charge', chargeId: charge.c.id, decision: charge.decision, reason } },
            {
              onSuccess: () => {
                toast.success(charge.decision === 'reverse' ? 'Charge reversed' : 'Charge waived')
                setCharge(null)
              },
              onError: (e) => toast.error('Could not update the charge', { description: errorMessage(e) }),
            },
          )
        }
      />
      <ReasonDialog
        open={dialog === 'writeoff'}
        onOpenChange={(o) => setDialog(o ? 'writeoff' : null)}
        title="Write off this debt?"
        description="The remaining amount will no longer count as owed to you. No cash moves and the record stays in your history."
        confirmLabel="Write off"
        pending={writeOff.isPending}
        onConfirm={(reason) =>
          writeOff.mutate(
            { id: d.id, reason },
            {
              onSuccess: () => {
                toast.success('Debt written off')
                setDialog(null)
              },
              onError: (err) => toast.error('Could not write off', { description: errorMessage(err) }),
            },
          )
        }
      />
    </div>
  )
}
