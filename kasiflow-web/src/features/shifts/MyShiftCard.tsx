import { useState } from 'react'
import { ArrowDownToLine, ArrowUpFromLine, CircleCheck, Clock, Lock, Unlock } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { NativeSelect, Textarea } from '@/components/ui/input'
import { Callout } from '@/components/shared/Callout'
import { Money } from '@/components/shared/Money'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { ErrorState } from '@/components/shared/States'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDateTime, parseRandToCents } from '@/lib/format'
import { varianceWording } from '@/lib/automation'
import { useBranches } from '@/features/branches/api'
import type { ShiftDto } from '@/types/automation'
import { useCashMovement, useCloseShift, useCurrentShift, useOpenShift } from './api'

export function BreakdownList({ s }: { s: ShiftDto }) {
  const b = s.breakdown
  const rows: [string, React.ReactNode, string?][] = [
    ['Opening float', <Money cents={s.openingFloatCents} />],
    [`Cash sales (${b.cashSalesCount})`, <Money cents={b.cashSalesCents} signed tone="income" />],
    ['Cash refunds', <Money cents={-b.cashRefundsCents} tone="auto" />],
    ['Paid-outs from the till', <Money cents={-b.paidOutsCents} tone="auto" />],
    ['Cash drops (to safe / bank)', <Money cents={-b.cashDropsCents} tone="auto" />],
    ['Float top-ups', <Money cents={b.floatTopUpsCents} signed />],
  ]
  return (
    <div>
      <dl className="divide-y divide-line rounded-md border border-line">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
            <dt className="text-ink-soft">{k}</dt>
            <dd className="font-medium">{v}</dd>
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 bg-forest-50 px-3 py-2.5">
          <dt className="text-sm font-semibold">{s.status === 'open' ? 'Expected cash in the till now' : 'Expected cash at close'}</dt>
          <dd className="font-display text-lg font-semibold">
            <Money cents={s.status === 'open' ? b.expectedNowCents : (s.expectedCashCents ?? b.expectedNowCents)} />
          </dd>
        </div>
      </dl>
      <p className="mt-2 flex items-center justify-between gap-3 px-1 text-[13px] text-ink-muted">
        <span>Card / QR / EFT sales — not in the till</span>
        <Money cents={b.nonCashSalesCents} tone="muted" />
      </p>
    </div>
  )
}

export function VarianceResult({ s }: { s: ShiftDto }) {
  const w = varianceWording(s.varianceCents)
  return (
    <Callout tone={w.tone === 'ok' ? 'neutral' : 'warning'} title={w.title}>
      <p>
        Counted <Money cents={s.countedCashCents} className="font-semibold" /> · expected <Money cents={s.expectedCashCents} className="font-semibold" />.
      </p>
      <p className="mt-1">{w.detail}</p>
      {s.needsReview && <p className="mt-1 font-medium">A manager will look at this cash-up with you.</p>}
    </Callout>
  )
}

function MovementDialog({ shift, kind, onOpenChange }: { shift: ShiftDto; kind: 'cash_drop' | 'float_top_up' | null; onOpenChange: (o: boolean) => void }) {
  const move = useCashMovement()
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  const close = (o: boolean) => {
    if (!o) {
      setAmount('')
      setNote('')
      setError(undefined)
    }
    onOpenChange(o)
  }
  return (
    <Dialog open={!!kind} onOpenChange={close}>
      <DialogContent>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            const cents = parseRandToCents(amount)
            if (!cents || cents <= 0) {
              setError('Enter an amount like 500 or 500.50.')
              return
            }
            move.mutate(
              { id: shift.id, kind: kind!, amountCents: cents, note: note.trim() || null },
              {
                onSuccess: () => {
                  toast.success(kind === 'cash_drop' ? 'Cash drop recorded' : 'Float top-up recorded')
                  close(false)
                },
                onError: (err) => (err instanceof ApiError && err.fieldError('amountCents') ? setError(err.fieldError('amountCents')) : toast.error('Could not save', { description: errorMessage(err) })),
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>{kind === 'cash_drop' ? 'Cash drop' : 'Float top-up'}</DialogTitle>
            <DialogDescription>
              {kind === 'cash_drop' ? 'Cash taken out of the till to a safe or the bank. It is not an expense.' : 'Cash put into the till, for example more change.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <Field id="mv-amount" label="Amount" error={error}>
              <MoneyInput autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field id="mv-note" label="Note" optional>
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={move.isPending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function CloseDialog({
  shift,
  open,
  onOpenChange,
  onClosed,
  closeShift,
}: {
  shift: ShiftDto
  open: boolean
  onOpenChange: (o: boolean) => void
  onClosed: (s: ShiftDto) => void
  /** Owned by the parent card: this dialog unmounts as soon as the shift is closed and refetched. */
  closeShift: ReturnType<typeof useCloseShift>
}) {
  const [counted, setCounted] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            const cents = parseRandToCents(counted)
            if (cents === null) {
              setError('Enter the cash you counted, like 1250 or 1250.50.')
              return
            }
            // mutateAsync: the result arrives even though this dialog unmounts when the shift query refetches.
            closeShift
              .mutateAsync({ id: shift.id, countedCashCents: cents, note: note.trim() || null })
              .then((closedShift) => {
                onClosed(closedShift)
                onOpenChange(false)
              })
              .catch((err: unknown) => toast.error('Could not close the shift', { description: errorMessage(err) }))
          }}
        >
          <DialogHeader>
            <DialogTitle>Close shift and cash up</DialogTitle>
            <DialogDescription>Count all the notes and coins in the till, including the float. Do this before looking at the expected amount.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            <Field id="close-counted" label="Cash counted in the till" error={error}>
              <MoneyInput autoFocus value={counted} onChange={(e) => setCounted(e.target.value)} />
            </Field>
            <Field id="close-note" label="Note" optional hint="Anything that helps explain a difference, e.g. 'gave R20 change from my own pocket'.">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={closeShift.isPending}>
              <Lock /> Close shift
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function OpenShiftForm() {
  const branches = useBranches()
  const open = useOpenShift()
  const active = (branches.data ?? []).filter((b) => b.isActive)
  const [branchId, setBranchId] = useState('')
  const [float, setFloat] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  return (
    <form
      noValidate
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault()
        const cents = float.trim() === '' ? 0 : parseRandToCents(float)
        const errs: Record<string, string> = {}
        if (cents === null) errs.openingFloatCents = 'Enter the cash in the till now, like 300 or 0.'
        if (active.length > 1 && !branchId) errs.branchId = 'Choose the branch you are working at.'
        setErrors(errs)
        if (Object.keys(errs).length) return
        // mutateAsync: this form unmounts as soon as the open shift is fetched.
        open
          .mutateAsync({ branchId: branchId || (active.length === 1 ? active[0].id : null), openingFloatCents: cents ?? 0 })
          .then(() => toast.success('Shift opened'))
          .catch((err: unknown) => {
            if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])))
            else toast.error('Could not open the shift', { description: errorMessage(err) })
          })
      }}
    >
      {active.length > 1 && (
        <Field id="open-branch" label="Branch" error={errors.branchId}>
          <NativeSelect value={branchId} onChange={(e) => setBranchId(e.target.value)}>
            <option value="">Choose a branch</option>
            {active.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
      )}
      <Field id="open-float" label="Opening float (cash in the till now)" error={errors.openingFloatCents} hint="Count it first. Leave empty for R0.00.">
        <MoneyInput value={float} onChange={(e) => setFloat(e.target.value)} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" loading={open.isPending}>
          <Unlock /> Open my shift
        </Button>
      </div>
    </form>
  )
}

/** "My shift": open, live breakdown, cash drops / top-ups, close with a non-accusatory variance. */
export function MyShiftCard() {
  const q = useCurrentShift()
  const [movement, setMovement] = useState<'cash_drop' | 'float_top_up' | null>(null)
  const [closing, setClosing] = useState(false)
  const [closed, setClosed] = useState<ShiftDto | null>(null)
  const closeShift = useCloseShift()
  const s = q.data

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="size-5 text-forest-800" aria-hidden /> My shift
        </CardTitle>
        <CardDescription>
          {s ? `${s.branchName} · opened ${formatDateTime(s.openedAt)}` : 'Open a shift before you start selling so your cash-up is worked out for you.'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {closed && (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <CircleCheck className="size-4 text-emerald-700" aria-hidden /> Shift closed at {closed.branchName}
            </p>
            <VarianceResult s={closed} />
          </div>
        )}
        {q.isLoading ? (
          <Skeleton className="h-40" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : s ? (
          <>
            <BreakdownList s={s} />
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setMovement('cash_drop')}>
                <ArrowUpFromLine /> Cash drop
              </Button>
              <Button variant="outline" onClick={() => setMovement('float_top_up')}>
                <ArrowDownToLine /> Float top-up
              </Button>
              <Button onClick={() => setClosing(true)}>
                <Lock /> Close shift
              </Button>
            </div>
            <MovementDialog shift={s} kind={movement} onOpenChange={(o) => !o && setMovement(null)} />
            <CloseDialog shift={s} open={closing} onOpenChange={setClosing} onClosed={setClosed} closeShift={closeShift} />
          </>
        ) : (
          <OpenShiftForm />
        )}
      </CardContent>
    </Card>
  )
}
