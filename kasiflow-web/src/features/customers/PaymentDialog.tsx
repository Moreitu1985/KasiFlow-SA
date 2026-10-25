import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect } from '@/components/ui/input'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { centsToRandInput, formatZAR, parseRandToCents, todayJhb } from '@/lib/format'
import { handleFormError } from '@/lib/forms'
import { ApiError } from '@/lib/apiClient'
import { isDuplicatePaymentConflict } from '@/lib/barbershop'
import { PAYMENT_METHODS, entries } from '@/lib/labels'
import { dateString, nullIfEmpty, optionalText, randAmount } from '@/lib/validation'
import type { PaymentInput, PaymentMethod } from '@/types/api'

const methodKeys = Object.keys(PAYMENT_METHODS) as [PaymentMethod, ...PaymentMethod[]]

/** Record a full or partial payment against a customer debt or a supplier bill. */
export function PaymentDialog({
  open,
  onOpenChange,
  kind,
  remainingCents,
  counterparty,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  kind: 'receivable' | 'payable'
  remainingCents: number
  counterparty: string
  onSubmit: (input: PaymentInput) => Promise<unknown>
}) {
  const schema = z.object({
    amount: randAmount().refine((v) => (parseRandToCents(v) ?? 0) <= remainingCents, `Cannot be more than the ${formatZAR(remainingCents)} still owed.`),
    paymentDate: dateString('Payment date').refine((v) => v <= todayJhb(), 'Payment date cannot be in the future.'),
    paymentMethod: z.enum(methodKeys),
    reference: optionalText(100),
  })
  type Values = z.infer<typeof schema>
  const { register, handleSubmit, formState, reset, setError, setValue } = useForm<Values>({ resolver: zodResolver(schema) })
  // Set when the API's duplicate guard (409) says the same payment was recorded minutes ago.
  const [duplicate, setDuplicate] = useState<{ input: PaymentInput; message: string } | null>(null)
  const [resending, setResending] = useState(false)
  useEffect(() => {
    if (open) {
      reset({ amount: centsToRandInput(remainingCents), paymentDate: todayJhb(), paymentMethod: 'cash', reference: '' })
      setDuplicate(null)
    }
  }, [open, remainingCents, reset])
  const e = formState.errors

  const send = async (input: PaymentInput) => {
    try {
      await onSubmit(input)
      toast.success('Payment recorded')
      setDuplicate(null)
      onOpenChange(false)
    } catch (err) {
      if (err instanceof ApiError && isDuplicatePaymentConflict(err.status, err.detail) && !input.confirmDuplicate) {
        setDuplicate({ input, message: err.detail ?? err.userMessage })
        return
      }
      handleFormError(err, setError, { amountCents: 'amount', paymentDate: 'paymentDate', paymentMethod: 'paymentMethod', reference: 'reference' }, 'Could not record payment')
    }
  }

  const submit = handleSubmit((v) =>
    send({
      amountCents: parseRandToCents(v.amount) ?? 0,
      paymentDate: v.paymentDate,
      paymentMethod: v.paymentMethod,
      reference: nullIfEmpty(v.reference),
    }),
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{kind === 'receivable' ? `Payment from ${counterparty}` : `Pay ${counterparty}`}</DialogTitle>
            <DialogDescription>
              {kind === 'receivable'
                ? 'This records income (category “Debt collection”) and reduces what the customer owes.'
                : 'This records an expense in the bill’s category and reduces what you owe.'}{' '}
              Still owed: <strong>{formatZAR(remainingCents)}</strong>.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Field id="p-amount" label="Amount paid" hint="Part payments are fine." error={e.amount?.message}>
              <MoneyInput autoFocus {...register('amount')} />
            </Field>
            <div className="-mt-2 flex gap-2">
              <Button type="button" size="sm" variant="secondary" onClick={() => setValue('amount', centsToRandInput(remainingCents))}>
                Full amount
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setValue('amount', centsToRandInput(Math.floor(remainingCents / 2)))}>
                Half
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="p-date" label="Payment date" error={e.paymentDate?.message}>
                <Input type="date" max={todayJhb()} {...register('paymentDate')} />
              </Field>
              <Field id="p-method" label="Method" error={e.paymentMethod?.message}>
                <NativeSelect {...register('paymentMethod')}>
                  {entries(PAYMENT_METHODS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field id="p-ref" label="Reference" optional error={e.reference?.message}>
              <Input {...register('reference')} />
            </Field>
            {kind === 'receivable' && (
              <p className="rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                Paid by EFT? Check the money is in your bank app before you record it. A screenshot or SMS is not proof of payment.
              </p>
            )}
            {duplicate && (
              <div role="alert" className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
                <p className="font-semibold">Possible double entry</p>
                <p>{duplicate.message}</p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    loading={resending}
                    onClick={async () => {
                      setResending(true)
                      await send({ ...duplicate.input, confirmDuplicate: true })
                      setResending(false)
                    }}
                  >
                    This is a separate payment
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
                    It was the same payment — close
                  </Button>
                </div>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={formState.isSubmitting} disabled={!!duplicate}>
              Record payment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
