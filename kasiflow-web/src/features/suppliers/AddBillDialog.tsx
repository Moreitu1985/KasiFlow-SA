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
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { addDays, parseRandToCents, todayJhb } from '@/lib/format'
import { handleFormError } from '@/lib/forms'
import { dateString, nullIfEmpty, optionalText, randAmount, requiredText } from '@/lib/validation'
import { useCategories } from '@/features/transactions/api'
import { useCreatePayable, useSuppliers } from './api'

const schema = z
  .object({
    supplierId: z.string().min(1, 'Choose a supplier.'),
    description: requiredText('Description', 200),
    category: z.string().min(1, 'Choose a category.'),
    amount: randAmount('Bill amount'),
    billDate: dateString('Bill date'),
    dueDate: dateString('Due date'),
    reference: optionalText(100),
    notes: optionalText(1000),
  })
  .refine((v) => v.dueDate >= v.billDate, { path: ['dueDate'], message: 'Due date cannot be before the bill date.' })
type Values = z.infer<typeof schema>

export function AddBillDialog({
  open,
  onOpenChange,
  presetSupplierId,
  onAddSupplier,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  presetSupplierId?: string
  onAddSupplier: () => void
}) {
  const suppliers = useSuppliers()
  const categories = useCategories()
  const create = useCreatePayable()
  const navigate = useNavigate()
  const { register, handleSubmit, formState, reset, setError } = useForm<Values>({ resolver: zodResolver(schema) })
  useEffect(() => {
    if (open)
      reset({
        supplierId: presetSupplierId ?? '',
        description: '',
        category: 'Stock & supplies',
        amount: '',
        billDate: todayJhb(),
        dueDate: addDays(todayJhb(), 14),
        reference: '',
        notes: '',
      })
  }, [open, presetSupplierId, reset])
  const e = formState.errors
  const noSuppliers = suppliers.data && suppliers.data.length === 0

  const submit = handleSubmit(async (v) => {
    try {
      const p = await create.mutateAsync({
        supplierId: v.supplierId,
        description: v.description.trim(),
        category: v.category,
        originalAmountCents: parseRandToCents(v.amount) ?? 0,
        billDate: v.billDate,
        dueDate: v.dueDate,
        reference: nullIfEmpty(v.reference),
        notes: nullIfEmpty(v.notes),
      })
      toast.success('Bill added')
      onOpenChange(false)
      navigate(`/suppliers/bills/${p.id}`)
    } catch (err) {
      handleFormError(err, setError, {
        supplierId: 'supplierId',
        description: 'description',
        category: 'category',
        originalAmountCents: 'amount',
        billDate: 'billDate',
        dueDate: 'dueDate',
        reference: 'reference',
        notes: 'notes',
      })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Add a supplier bill</DialogTitle>
            <DialogDescription>Stock or services you received and still need to pay for.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <div className="flex gap-2.5 rounded-md border border-sky-200 bg-sky-50 p-3 text-[13px] leading-relaxed text-sky-950">
              <Info className="mt-0.5 size-4 shrink-0 text-sky-700" aria-hidden />
              This does not count as an expense until you pay it. It is used in your cash forecast on its due date.
            </div>
            {noSuppliers ? (
              <div className="rounded-md border border-dashed border-line-strong p-4 text-sm">
                <p>You have no suppliers yet. Add the supplier first.</p>
                <Button type="button" size="sm" className="mt-3" onClick={onAddSupplier}>
                  Add supplier
                </Button>
              </div>
            ) : (
              <>
                <Field id="b-supplier" label="Supplier" error={e.supplierId?.message}>
                  <NativeSelect {...register('supplierId')} disabled={suppliers.isLoading}>
                    <option value="">{suppliers.isLoading ? 'Loading…' : 'Choose a supplier'}</option>
                    {suppliers.data?.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
                <button type="button" onClick={onAddSupplier} className="-mt-2 cursor-pointer self-start text-[13px] font-semibold text-forest-800 hover:underline">
                  + New supplier
                </button>
              </>
            )}
            <Field id="b-desc" label="Description" error={e.description?.message}>
              <Input placeholder="e.g. Bread delivery, week 42" {...register('description')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="b-amount" label="Bill amount" error={e.amount?.message}>
                <MoneyInput {...register('amount')} />
              </Field>
              <Field id="b-cat" label="Expense category" error={e.category?.message}>
                <NativeSelect {...register('category')}>
                  <option value="">Choose a category</option>
                  {categories.data?.expense.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="b-date" label="Bill date" error={e.billDate?.message}>
                <Input type="date" {...register('billDate')} />
              </Field>
              <Field id="b-due" label="Due date" error={e.dueDate?.message}>
                <Input type="date" {...register('dueDate')} />
              </Field>
            </div>
            <Field id="b-ref" label="Invoice number / reference" optional error={e.reference?.message}>
              <Input {...register('reference')} />
            </Field>
            <Field id="b-notes" label="Notes" optional error={e.notes?.message}>
              <Textarea rows={2} {...register('notes')} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={formState.isSubmitting} disabled={!!noSuppliers}>
              Add bill
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
