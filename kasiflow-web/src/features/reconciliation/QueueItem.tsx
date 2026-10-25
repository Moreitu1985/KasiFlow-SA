import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Ban, Link2, Link2Off, PlusCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/input'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Money } from '@/components/shared/Money'
import { ReasonDialog } from '@/components/shared/ReasonDialog'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { errorMessage } from '@/lib/apiClient'
import { formatDate, formatDateTime, humanize } from '@/lib/format'
import { PAYMENT_STATUS_LABELS, RECON_STATUS_LABELS, formatConfidence } from '@/lib/automation'
import type { MatchSuggestionDto, ReconciliationItemDto } from '@/types/automation'
import { useReconcileAction } from './api'

const UNRECONCILED = new Set(['needs_review', 'unmatched'])

export function PaymentSummary({ p }: { p: ReconciliationItemDto['payment'] }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant={p.sourceLabel === 'Demo simulation' ? 'forest' : 'outline'} className={p.sourceLabel === 'Demo simulation' ? 'border-ochre bg-ochre text-forest-950' : undefined}>
            {p.sourceLabel}
          </Badge>
          <Badge variant={p.status === 'completed' ? 'success' : p.status === 'pending' ? 'warning' : 'neutral'}>{PAYMENT_STATUS_LABELS[p.status] ?? p.status}</Badge>
          {p.kind === 'refund' && <Badge variant="warning">Refund</Badge>}
          <Badge variant="outline">{RECON_STATUS_LABELS[p.reconciliationStatus] ?? p.reconciliationStatus}</Badge>
        </div>
        <p className="mt-1.5 text-sm">
          <span className="font-semibold">{p.connectionName}</span> · {humanize(p.method)} · {formatDateTime(p.occurredAt)}
        </p>
        <p className="text-[13px] break-all text-ink-muted">
          Reference: {p.merchantReference ?? '—'} · Provider ID: {p.externalPaymentId}
        </p>
      </div>
      <div className="shrink-0 sm:text-right">
        <p className="text-[12px] text-ink-muted">Gross</p>
        <Money cents={p.grossCents} className="font-display text-xl font-semibold" />
        {p.tipCents > 0 && (
          <p className="text-[12px] text-ink-muted">
            incl. tip <Money cents={p.tipCents} />
          </p>
        )}
        {!p.countsAsIncome && p.kind === 'payment' && <p className="text-[12px] font-medium text-amber-800">Not counted as income</p>}
      </div>
    </div>
  )
}

function SuggestionRow({ s, onMatch, busy, disabled }: { s: MatchSuggestionDto; onMatch: () => void; busy: boolean; disabled: boolean }) {
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-md border border-line bg-paper p-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          <Link to={`/transactions/${s.transactionId}`} className="hover:underline">
            {s.description || 'Recorded sale'}
          </Link>
        </p>
        <p className="text-[13px] text-ink-muted">
          <Money cents={s.amountCents} /> · {formatDate(s.date)} · Ref {s.reference ?? '—'}
        </p>
        <p className="text-[12px] text-ink-muted">
          <span className="font-semibold text-ink">{formatConfidence(s.confidence)} confidence.</span> {s.reason}
        </p>
      </div>
      <Button size="sm" variant="secondary" className="shrink-0 self-start sm:self-center" loading={busy} disabled={disabled} onClick={onMatch}>
        <Link2 /> Match to this sale
      </Button>
    </li>
  )
}

export function QueueItem({ item, canManage }: { item: ReconciliationItemDto; canManage: boolean }) {
  const action = useReconcileAction()
  const p = item.payment
  const [ignoreOpen, setIgnoreOpen] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [unmatchOpen, setUnmatchOpen] = useState(false)
  const [unmatchNote, setUnmatchNote] = useState('')
  const open = UNRECONCILED.has(p.reconciliationStatus)
  const busy = action.isPending
  // The API only reconciles completed payments; pending ones are not income yet.
  const decidable = p.kind === 'payment' && p.status === 'completed'

  // mutateAsync: the item usually leaves this queue after a decision, unmounting this card before callbacks would run.
  const run = (a: Parameters<typeof action.mutateAsync>[0], msg: string, close?: () => void) =>
    action
      .mutateAsync(a)
      .then(() => {
        toast.success(msg)
        close?.()
      })
      .catch((e: unknown) => toast.error('Could not save the decision', { description: errorMessage(e) }))

  return (
    <Card className="min-w-0">
      <CardContent className="space-y-4 pt-5">
        <PaymentSummary p={p} />

        {p.transactionId && (
          <p className="text-[13px]">
            Linked sale:{' '}
            <Link to={`/transactions/${p.transactionId}`} className="font-semibold text-forest-800 hover:underline">
              open transaction
            </Link>
          </p>
        )}

        {open && item.suggestions.length > 0 && (
          <div>
            <h4 className="font-sans text-[13px] font-semibold">Possible matching sales</h4>
            <ul className="mt-2 space-y-2">
              {item.suggestions.map((s) => (
                <SuggestionRow
                  key={`${s.id}-${s.transactionId}`}
                  s={s}
                  busy={busy && action.variables?.kind === 'match' && action.variables.transactionId === s.transactionId}
                  disabled={!canManage || busy || !decidable}
                  onMatch={() => run({ kind: 'match', id: p.id, transactionId: s.transactionId }, 'Matched to the recorded sale')}
                />
              ))}
            </ul>
          </div>
        )}
        {open && item.suggestions.length === 0 && <p className="text-[13px] text-ink-muted">No recorded sale looks like this payment.</p>}

        {canManage && !decidable && (
          <p className="text-[13px] text-ink-muted">
            Only completed payments can be reconciled. {p.status === 'pending' ? 'Pending payments are not income yet.' : 'This one is not a completed payment.'}
          </p>
        )}
        {canManage && decidable && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            {open ? (
              <>
                <Button size="sm" disabled={busy} onClick={() => setCreateOpen(true)}>
                  <PlusCircle /> Create sale from payment
                </Button>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => setIgnoreOpen(true)}>
                  <Ban /> Ignore
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => setUnmatchOpen(true)}>
                <Link2Off /> Unmatch
              </Button>
            )}
          </div>
        )}
      </CardContent>

      <ConfirmDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Create a sale from this payment?"
        description={
          <>
            A new sale of <Money cents={p.grossCents} className="font-semibold" /> is recorded with the origin “{p.sourceLabel}”. Only do this if nobody recorded
            this sale by hand, otherwise it is counted twice.
          </>
        }
        confirmLabel="Create sale"
        pending={busy}
        onConfirm={() => run({ kind: 'create-sale', id: p.id }, 'Sale created from the payment', () => setCreateOpen(false))}
      />
      <ReasonDialog
        open={ignoreOpen}
        onOpenChange={setIgnoreOpen}
        title="Ignore this payment?"
        description="Use this when the payment is not a sale (for example a test or a transfer between your own accounts). It stays on record with your reason and can be unmatched later."
        reasonLabel="Why is this not a sale?"
        confirmLabel="Ignore payment"
        pending={busy}
        onConfirm={(note) => run({ kind: 'ignore', id: p.id, note }, 'Payment ignored', () => setIgnoreOpen(false))}
      />
      <Dialog open={unmatchOpen} onOpenChange={setUnmatchOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Unmatch this payment?</DialogTitle>
            <DialogDescription>
              {p.reconciliationStatus === 'created_sale'
                ? 'The sale created from this payment is voided (kept on record) and the payment goes back to the review queue.'
                : 'The link is removed and the payment goes back to the review queue. A matched hand-recorded sale goes back to “recorded manually”.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field id={`unmatch-${p.id}`} label="Note" optional>
              <Textarea value={unmatchNote} onChange={(e) => setUnmatchNote(e.target.value)} maxLength={300} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setUnmatchOpen(false)}>
              Keep as is
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={() =>
                run({ kind: 'unmatch', id: p.id, note: unmatchNote.trim() || undefined }, 'Payment unmatched', () => {
                  setUnmatchOpen(false)
                  setUnmatchNote('')
                })
              }
            >
              Unmatch
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
