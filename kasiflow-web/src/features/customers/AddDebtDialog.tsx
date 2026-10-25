import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Info } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { addDays, parseRandToCents, todayJhb } from '@/lib/format'
import { handleFormError } from '@/lib/forms'
import { dateString, nullIfEmpty, optionalDate, optionalText, randAmount, requiredText } from '@/lib/validation'
import { useAccess } from '@/features/access/useAccess'
import { useDebtPolicy } from '@/features/debts/api'
import { useCreateReceivable, useCustomers } from './api'

const schema = z
  .object({
    customerId: z.string().min(1, 'Choose a customer.'),
    description: requiredText('What it was for', 200),
    amount: randAmount('Amount owed'),
    issueDate: dateString('Date').refine((v) => v <= todayJhb(), 'Date cannot be in the future.'),
    dueDate: optionalDate,
    notes: optionalText(1000),
    reference: optionalText(60),
    chargeTermsDisclosed: z.boolean(),
  })
  .refine((v) => !v.dueDate || v.dueDate >= v.issueDate, { path: ['dueDate'], message: 'Due date cannot be before the date it was given.' })
type Values = z.infer<typeof schema>

export function AddDebtDialog({
  open,
  onOpenChange,
  presetCustomerId,
  onAddCustomer,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  presetCustomerId?: string
  onAddCustomer: () => void
}) {
  const customers = useCustomers()
  const create = useCreateReceivable()
  const navigate = useNavigate()
  const { can } = useAccess()
  const policy = useDebtPolicy(open && can('viewFinancials', 'recordDebtPayments', 'configureDebtPolicy'))
  const terms = policy.data?.terms?.trim() ? policy.data.terms : null
  const { register, handleSubmit, formState, reset, setError } = useForm<Values>({ resolver: zodResolver(schema) })
  useEffect(() => {
    if (open)
      reset({ customerId: presetCustomerId ?? '', description: '', amount: '', issueDate: todayJhb(), dueDate: addDays(todayJhb(), 7), notes: '', reference: '', chargeTermsDisclosed: false })
  }, [open, presetCustomerId, reset])
  const e = formState.errors
  const noCustomers = customers.data && customers.data.length === 0

  const submit = handleSubmit(async (v) => {
    try {
      const r = await create.mutateAsync({
        customerId: v.customerId,
        description: v.description.trim(),
        originalAmountCents: parseRandToCents(v.amount) ?? 0,
        issueDate: v.issueDate,
        dueDate: nullIfEmpty(v.dueDate),
        notes: nullIfEmpty(v.notes),
        reference: nullIfEmpty(v.reference),
        chargeTermsDisclosed: !!terms && v.chargeTermsDisclosed,
      })
      toast.success('Debt recorded')
      onOpenChange(false)
      navigate(`/debts/${r.id}`)
    } catch (err) {
      handleFormError(err, setError, { customerId: 'customerId', description: 'description', originalAmountCents: 'amount', issueDate: 'issueDate', dueDate: 'dueDate', notes: 'notes' })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Record money a customer owes</DialogTitle>
            <DialogDescription>For goods or services given on credit (“on the book”).</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <div className="flex gap-2.5 rounded-md border border-sky-200 bg-sky-50 p-3 text-[13px] leading-relaxed text-sky-950">
              <Info className="mt-0.5 size-4 shrink-0 text-sky-700" aria-hidden />
              This does not count as income until the customer pays. When they pay, record the payment on the debt and it becomes income automatically.
            </div>
            {noCustomers ? (
              <div className="rounded-md border border-dashed border-line-strong p-4 text-sm">
                <p>You have no customers yet. Add the customer first.</p>
                <Button type="button" size="sm" className="mt-3" onClick={onAddCustomer}>
                  Add customer
                </Button>
              </div>
            ) : (
              <Field id="d-customer" label="Customer" error={e.customerId?.message}>
                <NativeSelect {...register('customerId')} disabled={customers.isLoading}>
                  <option value="">{customers.isLoading ? 'Loading…' : 'Choose a customer'}</option>
                  {customers.data?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {!noCustomers && (
              <button type="button" onClick={onAddCustomer} className="-mt-2 self-start text-[13px] font-semibold text-forest-800 hover:underline cursor-pointer">
                + New customer
              </button>
            )}
            <Field id="d-desc" label="What it was for" error={e.description?.message}>
              <Input placeholder="e.g. Groceries on credit" {...register('description')} />
            </Field>
            <Field id="d-amount" label="Amount owed" error={e.amount?.message}>
              <MoneyInput {...register('amount')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="d-issue" label="Date given" error={e.issueDate?.message}>
                <Input type="date" max={todayJhb()} {...register('issueDate')} />
              </Field>
              <Field id="d-due" label="Due date" optional hint="When they promised to pay." error={e.dueDate?.message}>
                <Input type="date" {...register('dueDate')} />
              </Field>
            </div>
            <Field id="d-ref" label="Reference" optional hint="e.g. a booking or invoice number the customer will recognise." error={e.reference?.message}>
              <Input maxLength={60} {...register('reference')} />
            </Field>
            <Field id="d-notes" label="Notes" optional error={e.notes?.message}>
              <Textarea rows={2} {...register('notes')} />
            </Field>
            {terms && (
              <div className="space-y-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-[13px] text-amber-950">
                <p className="font-semibold">Late-charge terms</p>
                <p className="whitespace-pre-wrap">{terms}</p>
                {!policy.data?.enabled && <p>The late-charge policy is switched off, so no charge will be added.</p>}
                <label className="flex items-start gap-2.5 text-sm">
                  <Checkbox className="mt-0.5" {...register('chargeTermsDisclosed')} />
                  <span>Customer was shown the late-charge terms</span>
                </label>
              </div>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={formState.isSubmitting} disabled={!!noCustomers}>
              Record debt
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
