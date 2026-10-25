import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertTriangle, Check, Copy as CopyIcon, FileImage, FileUp, Scale, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Callout } from '@/components/shared/Callout'
import { Money } from '@/components/shared/Money'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { RoleHeader } from '@/features/access/RoleHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { ProofStatusBadge } from '@/components/shared/StatusBadges'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDate, formatDateTime, formatZAR, parseRandToCents } from '@/lib/format'
import { useAccess } from '@/features/access/useAccess'
import { ProviderPaymentsTable } from '@/features/reconciliation/ReconciliationPage'
import { useTransactions } from '@/features/transactions/api'
import type { PaymentProofDto, ProofStatus } from '@/types/barbershop'
import { openProofFile, useDecideProof, useProofs, useUploadProof } from './api'

const MAX_BYTES = 2 * 1024 * 1024
const PROOF_WARNING = 'A proof of payment is not proof that money cleared. Check your bank account or payment provider before treating it as paid.'

function UploadDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const upload = useUploadProof()
  const { can } = useAccess()
  const pending = useTransactions({ type: 'income', status: 'posted', page: 1, pageSize: 50 })
  const awaiting = useMemo(() => (pending.data?.items ?? []).filter((t) => t.paymentStatus === 'awaiting_confirmation'), [pending.data])
  const [file, setFile] = useState<File | null>(null)
  const [amount, setAmount] = useState('')
  const [reference, setReference] = useState('')
  const [payer, setPayer] = useState('')
  const [txId, setTxId] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  useEffect(() => {
    if (open) {
      setFile(null)
      setAmount('')
      setReference('')
      setPayer('')
      setTxId('')
      setErrors({})
    }
  }, [open])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const err: Record<string, string> = {}
    if (!file) err.file = 'Choose the proof file (photo, screenshot or PDF).'
    else if (file.size > MAX_BYTES) err.file = 'The file must be 2 MB or smaller.'
    else if (!/^(image\/(png|jpeg)|application\/pdf)$/.test(file.type) && !/\.(png|jpe?g|pdf)$/i.test(file.name)) err.file = 'Only PNG, JPEG or PDF files are accepted.'
    const cents = amount.trim() ? parseRandToCents(amount) : null
    if (amount.trim() && !cents) err.claimedAmountCents = 'Enter the amount shown on the proof.'
    setErrors(err)
    if (Object.keys(err).length || !file) return
    upload.mutate(
      { file, claimedAmountCents: cents, claimedReference: reference.trim() || null, payerName: payer.trim() || null, transactionId: txId || null },
      {
        onSuccess: (p) => {
          toast.success('Proof saved as unverified', { description: p.duplicateFile ? 'The same file was uploaded before — check it is not being reused.' : 'Check your bank before treating it as paid.' })
          onOpenChange(false)
        },
        onError: (er) => {
          if (er instanceof ApiError && Object.keys(er.errors).length) setErrors(Object.fromEntries(Object.entries(er.errors).map(([k, v]) => [k, v[0]])))
          else toast.error('Could not upload', { description: errorMessage(er) })
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Add a proof of payment</DialogTitle>
            <DialogDescription>Keep the screenshot or PDF a customer sent. It stays “unverified” until someone sees the money in the bank.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-4">
            <p className="rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-950">{PROOF_WARNING}</p>
            <Field id="pf-file" label="File" hint="PNG, JPEG or PDF, up to 2 MB." error={errors.file}>
              <Input type="file" accept="image/png,image/jpeg,application/pdf" className="h-auto py-2" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="pf-amt" label="Amount on the proof" optional error={errors.claimedAmountCents}>
                <MoneyInput value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
              <Field id="pf-ref" label="Reference on the proof" optional error={errors.claimedReference}>
                <Input maxLength={80} value={reference} onChange={(e) => setReference(e.target.value)} />
              </Field>
            </div>
            <Field id="pf-payer" label="Who paid" optional error={errors.payerName}>
              <Input maxLength={120} value={payer} onChange={(e) => setPayer(e.target.value)} />
            </Field>
            {can('viewFinancials', 'recordSales') && (
              <Field
                id="pf-tx"
                label="Link to a sale awaiting confirmation"
                optional
                hint={awaiting.length === 0 ? 'No recent sales are waiting for confirmation.' : 'When someone confirms the proof in the bank, that sale is marked as received.'}
                error={errors.transactionId}
              >
                <NativeSelect value={txId} onChange={(e) => setTxId(e.target.value)} disabled={awaiting.length === 0}>
                  <option value="">Do not link</option>
                  {awaiting.map((t) => (
                    <option key={t.id} value={t.id}>
                      {formatDate(t.transactionDate)} · {formatZAR(t.amountCents)} · {t.description.slice(0, 40)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={upload.isPending}>
              <FileUp /> Save proof
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DecideDialog({ proof, confirm, onOpenChange }: { proof: PaymentProofDto | null; confirm: boolean; onOpenChange: (o: boolean) => void }) {
  const decide = useDecideProof()
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (proof) {
      setNote('')
      setError(undefined)
    }
  }, [proof])
  return (
    <Dialog open={!!proof} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{confirm ? 'Confirm the money is in your bank' : 'Reject this proof'}</DialogTitle>
          <DialogDescription>
            {confirm
              ? 'Only confirm if you have seen the money in your own banking app or statement — not just the screenshot. Your name and note are recorded.'
              : 'Say why. If it is linked to a sale, that sale is marked as failed.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {proof && (
            <p className="text-sm">
              {proof.payerName ?? 'Unknown payer'} · {proof.claimedAmountCents ? formatZAR(proof.claimedAmountCents) : 'no amount given'}
              {proof.claimedReference && ` · ref ${proof.claimedReference}`}
            </p>
          )}
          <Field id="pd-note" label={confirm ? 'Where did you see the money?' : 'Reason'} hint={confirm ? 'e.g. “FNB app, 16 Oct, ref POP-002”' : undefined} error={error}>
            <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant={confirm ? 'default' : 'destructive'}
            loading={decide.isPending}
            onClick={() => {
              if (note.trim().length < 3) return setError(confirm ? 'Say where you saw the money.' : 'Say why the proof is rejected.')
              if (!proof) return
              decide.mutate(
                { id: proof.id, confirm, note: note.trim() },
                {
                  onSuccess: () => {
                    toast.success(confirm ? 'Confirmed in bank' : 'Proof rejected')
                    onOpenChange(false)
                  },
                  onError: (e) => setError(errorMessage(e)),
                },
              )
            }}
          >
            {confirm ? 'Confirm in bank' : 'Reject proof'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Proofs() {
  const { can } = useAccess()
  const [status, setStatus] = useState<ProofStatus | ''>('')
  const q = useProofs(status)
  const [uploading, setUploading] = useState(false)
  const [deciding, setDeciding] = useState<{ proof: PaymentProofDto; confirm: boolean } | null>(null)
  const open = async (id: string) => {
    try {
      await openProofFile(id)
    } catch (e) {
      toast.error('Could not open the file', { description: errorMessage(e) })
    }
  }
  return (
    <div className="space-y-4">
      <Callout tone="warning" title="Screenshots are not money">
        {PROOF_WARNING} Fake proofs of payment are one of the most common scams against small businesses.
      </Callout>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:w-60">
          <Label htmlFor="pf-status">Status</Label>
          <NativeSelect id="pf-status" className="mt-1.5" value={status} onChange={(e) => setStatus(e.target.value as ProofStatus | '')}>
            <option value="">All proofs</option>
            <option value="unverified">Unverified</option>
            <option value="confirmed_in_bank">Confirmed in bank</option>
            <option value="verified_by_provider">Verified by provider</option>
            <option value="rejected">Rejected</option>
          </NativeSelect>
        </div>
        {can('manageFinancials', 'recordSales', 'recordDebtPayments') && (
          <Button onClick={() => setUploading(true)}>
            <FileUp /> Add proof of payment
          </Button>
        )}
      </div>
      {q.isLoading ? (
        <ListSkeleton rows={3} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.length ? (
        <EmptyState icon={FileImage} title="No proofs of payment" description="When a customer sends a payment screenshot, save it here so it can be checked against your bank." />
      ) : (
        <ul className="space-y-3">
          {q.data.map((p) => (
            <li key={p.id}>
              <Card className="min-w-0">
                <CardContent className="flex flex-col gap-3 pt-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-semibold">{p.payerName ?? 'Unknown payer'}</p>
                      <ProofStatusBadge status={p.status} label={p.statusLabel} />
                      {p.duplicateFile && (
                        <Badge variant="critical">
                          <CopyIcon aria-hidden /> Same file uploaded before
                        </Badge>
                      )}
                    </div>
                    <p className="text-sm">
                      {p.claimedAmountCents != null ? <Money cents={p.claimedAmountCents} className="font-semibold" /> : 'No amount given'}
                      {p.claimedReference && <span className="text-ink-muted"> · ref {p.claimedReference}</span>}
                    </p>
                    <p className="text-[12px] text-ink-muted">
                      Uploaded {formatDateTime(p.createdAt)} · {p.fileName}
                    </p>
                    <p className="flex flex-wrap gap-x-3 text-[13px]">
                      {p.transactionId && (
                        <Link to={`/transactions/${p.transactionId}`} className="font-medium text-forest-800 hover:underline">
                          Linked sale
                        </Link>
                      )}
                      {p.bookingId && (
                        <Link to={`/bookings/${p.bookingId}`} className="font-medium text-forest-800 hover:underline">
                          Linked booking
                        </Link>
                      )}
                      {p.receivableId && (
                        <Link to={`/debts/${p.receivableId}`} className="font-medium text-forest-800 hover:underline">
                          Linked debt
                        </Link>
                      )}
                    </p>
                    {p.verificationNote && (
                      <p className="text-[13px] text-ink-soft">
                        Note: {p.verificationNote} {p.verifiedAt && <span className="text-ink-muted">({formatDateTime(p.verifiedAt)})</span>}
                      </p>
                    )}
                    {p.status === 'unverified' && (
                      <p className="flex gap-1.5 text-[12px] text-amber-800">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden /> {p.warning}
                      </p>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-2 sm:flex-col sm:items-stretch">
                    <Button size="sm" variant="outline" onClick={() => void open(p.id)}>
                      <FileImage /> Open file
                    </Button>
                    {p.status === 'unverified' && can('manageFinancials') && (
                      <>
                        <Button size="sm" onClick={() => setDeciding({ proof: p, confirm: true })}>
                          <Check /> Confirm in bank
                        </Button>
                        <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setDeciding({ proof: p, confirm: false })}>
                          <X /> Reject
                        </Button>
                      </>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <UploadDialog open={uploading} onOpenChange={setUploading} />
      <DecideDialog proof={deciding?.proof ?? null} confirm={!!deciding?.confirm} onOpenChange={(o) => !o && setDeciding(null)} />
    </div>
  )
}

export function PaymentsPage() {
  const { can } = useAccess()
  const [params, setParams] = useSearchParams()
  const showProofs = can('viewFinancials', 'recordSales', 'recordDebtPayments')
  const showProviders = can('viewIntegrations')
  const tab = params.get('tab') === 'providers' && showProviders ? 'providers' : showProofs ? 'proofs' : 'providers'
  return (
    <div className="space-y-5">
      <RoleHeader
        title="Payments"
        description="Proofs customers send you, and payments reported by connected providers. Only money you can see in your account counts as received."
       
        actions={
          can('manageReconciliation', 'viewIntegrations') && (
            <Button asChild variant="outline">
              <Link to="/reconciliation">
                <Scale /> Reconciliation
              </Link>
            </Button>
          )
        }
      />
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'providers' ? { tab: 'providers' } : {}, { replace: true })}>
        <TabsList>
          {showProofs && <TabsTrigger value="proofs">Proofs of payment</TabsTrigger>}
          {showProviders && <TabsTrigger value="providers">Provider payments</TabsTrigger>}
        </TabsList>
        {showProofs && (
          <TabsContent value="proofs">
            <Proofs />
          </TabsContent>
        )}
        {showProviders && (
          <TabsContent value="providers" className="space-y-3">
            <p className="text-[13px] text-ink-muted">
              Payments reported by your connected payment providers. A pending payment is not income yet. Match them to sales on the{' '}
              <Link to="/reconciliation" className="font-semibold text-forest-800 hover:underline">
                Reconciliation
              </Link>{' '}
              page.
            </p>
            {tab === 'providers' && <ProviderPaymentsTable />}
          </TabsContent>
        )}
      </Tabs>
    </div>
  )
}
