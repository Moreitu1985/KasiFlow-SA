import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { BadgeCheck, Landmark, ShieldAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Callout } from '@/components/shared/Callout'
import { ErrorState, ListSkeleton } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDateTime } from '@/lib/format'
import { accountDigits, BANK_SOURCES, BANK_STATUS_LABELS, BANK_VERIFY_METHODS } from '@/lib/barbershop'
import { entries } from '@/lib/labels'
import { useAccess } from '@/features/access/useAccess'
import type { BankChangeSource, BankVerifyMethod, SupplierBankDetailDto } from '@/types/barbershop'
import type { SupplierDto } from '@/types/api'
import { useBankAction, useBankDetails } from './bankApi'

function Decide({ supplierId, d }: { supplierId: string; d: SupplierBankDetailDto }) {
  const act = useBankAction()
  const [mode, setMode] = useState<'verify' | 'reject' | null>(null)
  const [method, setMethod] = useState<BankVerifyMethod>('called_known_number')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  if (!mode)
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setMode('verify')}>
          <BadgeCheck /> Verify
        </Button>
        <Button size="sm" variant="ghost" className="text-red-700" onClick={() => setMode('reject')}>
          Reject
        </Button>
      </div>
    )
  return (
    <div className="space-y-2 rounded-md border border-line bg-paper/60 p-3">
      {mode === 'verify' && (
        <Field id={`bv-m-${d.id}`} label="How did you verify it independently?">
          <NativeSelect value={method} onChange={(e) => setMethod(e.target.value as BankVerifyMethod)}>
            {entries(BANK_VERIFY_METHODS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field id={`bv-n-${d.id}`} label={mode === 'verify' ? 'What you did' : 'Why you reject it'} hint={mode === 'verify' ? 'e.g. Called Sipho on 011… from our old invoice' : undefined} error={error}>
        <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant={mode === 'verify' ? 'default' : 'destructive'}
          loading={act.isPending}
          onClick={() => {
            if (note.trim().length < 3) return setError('Write what you did.')
            act.mutate(
              { supplierId, m: { kind: mode, id: d.id, input: { method: mode === 'verify' ? method : null, note: note.trim() } } },
              {
                onSuccess: () => {
                  toast.success(mode === 'verify' ? 'Bank details verified' : 'Bank details rejected')
                  setMode(null)
                },
                onError: (e) => setError(errorMessage(e)),
              },
            )
          }}
        >
          {mode === 'verify' ? 'Mark as verified' : 'Reject details'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode(null)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

function AddForm({ supplierId, onDone }: { supplierId: string; onDone: () => void }) {
  const act = useBankAction()
  const [bank, setBank] = useState('')
  const [holder, setHolder] = useState('')
  const [account, setAccount] = useState('')
  const [source, setSource] = useState<BankChangeSource>('owner_entry')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const digits = accountDigits(account)
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const err: Record<string, string> = {}
    if (bank.trim().length < 2) err.bankName = 'Enter the bank.'
    if (holder.trim().length < 2) err.accountHolder = 'Enter the account holder.'
    if (digits.length < 6 || digits.length > 20) err.accountNumber = 'Enter the account number (6–20 digits).'
    setErrors(err)
    if (Object.keys(err).length) return
    act.mutate(
      { supplierId, m: { kind: 'add', input: { bankName: bank.trim(), accountHolder: holder.trim(), accountNumber: digits, changeSource: source } } },
      {
        onSuccess: () => {
          // The full number is never kept in the browser after sending.
          setAccount('')
          toast.success('Bank details saved as NOT verified', { description: 'Verify them independently before paying.' })
          onDone()
        },
        onError: (er) => {
          setAccount('')
          if (er instanceof ApiError && Object.keys(er.errors).length) setErrors(Object.fromEntries(Object.entries(er.errors).map(([k, v]) => [k, v[0]])))
          else toast.error('Could not save', { description: errorMessage(er) })
        },
      },
    )
  }
  return (
    <form onSubmit={submit} noValidate className="space-y-3 rounded-md border border-line p-3">
      <p className="text-sm font-semibold">Add new bank details</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="bk-bank" label="Bank" error={errors.bankName}>
          <Input maxLength={60} value={bank} onChange={(e) => setBank(e.target.value)} />
        </Field>
        <Field id="bk-holder" label="Account holder" error={errors.accountHolder}>
          <Input maxLength={120} value={holder} onChange={(e) => setHolder(e.target.value)} />
        </Field>
      </div>
      <Field id="bk-acc" label="Account number" hint="Sent once. Only the last 4 digits are stored and shown again." error={errors.accountNumber}>
        <Input inputMode="numeric" autoComplete="off" value={account} onChange={(e) => setAccount(e.target.value)} />
      </Field>
      <Field id="bk-src" label="Where did these details come from?" error={errors.changeSource}>
        <NativeSelect value={source} onChange={(e) => setSource(e.target.value as BankChangeSource)}>
          {entries(BANK_SOURCES).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </Field>
      {source === 'supplier_message' && (
        <p className="text-[13px] text-amber-900">
          A message asking you to pay a new account is the most common supplier scam. Phone the supplier on a number you already had before you pay.
        </p>
      )}
      <Button type="submit" size="sm" loading={act.isPending}>
        Save details
      </Button>
    </form>
  )
}

/** Supplier bank details with independent verification. KasiFlow never pays suppliers; it helps you avoid paying a fraudster. */
export function BankDetailsDialog({ supplier, onOpenChange }: { supplier: SupplierDto | null; onOpenChange: (o: boolean) => void }) {
  const { can } = useAccess()
  const q = useBankDetails(supplier?.id)
  const [adding, setAdding] = useState(false)
  useEffect(() => setAdding(false), [supplier])
  const hasUnverified = (q.data ?? []).some((d) => d.status === 'unverified')
  return (
    <Dialog open={!!supplier} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>{supplier?.name}: bank details</DialogTitle>
          <DialogDescription>Only the last four digits are kept. Changed details must be confirmed with the supplier on a number you already had.</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-4">
          {hasUnverified && (
            <Callout tone="critical" title="Do not pay the unverified account">
              New or changed bank details have not been verified. Phone the supplier on a number you already had (not one from the message or invoice) before paying.
            </Callout>
          )}
          {q.isLoading ? (
            <ListSkeleton rows={2} />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data?.length ? (
            <p className="flex items-center gap-2 text-sm text-ink-muted">
              <Landmark className="size-4" aria-hidden /> No bank details recorded.
            </p>
          ) : (
            <ul className="space-y-3">
              {q.data.map((d) => (
                <li key={d.id} className="space-y-2 rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-mono text-sm font-semibold">{d.accountMasked}</p>
                    <Badge variant={d.status === 'verified' ? 'success' : d.status === 'unverified' ? 'critical' : 'neutral'}>
                      {d.status === 'unverified' && <ShieldAlert aria-hidden />}
                      {BANK_STATUS_LABELS[d.status] ?? d.status}
                    </Badge>
                    {d.sameAsVerified && d.status !== 'verified' && <Badge variant="outline">Same as verified account</Badge>}
                  </div>
                  <p className="text-sm">
                    {d.bankName} · {d.accountHolder}
                  </p>
                  <p className="text-[12px] text-ink-muted">
                    Added {formatDateTime(d.createdAt)} · {BANK_SOURCES[d.changeSource] ?? d.changeSource}
                  </p>
                  {d.verificationNote && (
                    <p className="text-[13px] text-ink-soft">
                      {d.verificationMethod && <strong>{BANK_VERIFY_METHODS[d.verificationMethod]}: </strong>}
                      {d.verificationNote} {d.verifiedAt && <span className="text-ink-muted">({formatDateTime(d.verifiedAt)})</span>}
                    </p>
                  )}
                  {d.status === 'unverified' && can('verifySupplierBankDetails') && supplier && <Decide supplierId={supplier.id} d={d} />}
                </li>
              ))}
            </ul>
          )}
          {can('manageFinancials') && supplier &&
            (adding ? (
              <AddForm supplierId={supplier.id} onDone={() => setAdding(false)} />
            ) : (
              <Button variant="outline" onClick={() => setAdding(true)}>
                <Landmark /> Add new bank details
              </Button>
            ))}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
