import { useEffect, useMemo, useRef, useState } from 'react'
import { useFieldArray, useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { ArrowDownLeft, ArrowUpRight, PackagePlus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { centsToRandInput, formatZAR, parseRandToCents, todayJhb } from '@/lib/format'
import { newIdempotencyKey } from '@/lib/automation'
import { useAccess } from '@/features/access/useAccess'
import { useBranches } from '@/features/branches/api'
import { useProducts } from '@/features/inventory/api'
import { PAYMENT_METHODS, PAYMENT_STATUS, entries } from '@/lib/labels'
import { handleFormError } from '@/lib/forms'
import { dateString, nullIfEmpty, optionalText, randAmount, requiredText } from '@/lib/validation'
import { cn } from '@/lib/utils'
import type { InputPaymentStatus, PaymentMethod, TransactionDto, TransactionType } from '@/types/api'
import { useCategories, useSaveTransaction } from './api'

const methodKeys = Object.keys(PAYMENT_METHODS) as [PaymentMethod, ...PaymentMethod[]]
const statusKeys: [InputPaymentStatus, ...InputPaymentStatus[]] = ['recorded_manually', 'awaiting_confirmation', 'failed', 'cancelled']

const schema = z
  .object({
    type: z.enum(['income', 'expense']),
    description: requiredText('Description', 200),
    amount: randAmount(),
    category: z.string().min(1, 'Choose a category.'),
    transactionDate: dateString(),
    paymentMethod: z.enum(methodKeys),
    paymentStatus: z.enum(statusKeys),
    status: z.enum(['posted', 'scheduled']),
    reference: optionalText(100),
    notes: optionalText(1000),
    branchId: z.string(),
    lines: z.array(
      z.object({
        productId: z.string().min(1, 'Choose a product.'),
        quantity: z.string().regex(/^\d{1,4}$/, 'Whole number').refine((q) => Number(q) >= 1 && Number(q) <= 1000, '1 to 1000'),
      }),
    ),
  })
  .superRefine((v, ctx) => {
    const today = todayJhb()
    if (v.status === 'posted' && v.transactionDate > today)
      ctx.addIssue({ code: 'custom', path: ['transactionDate'], message: 'A transaction that already happened cannot be in the future. Mark it as planned instead.' })
    if (v.status === 'scheduled' && v.transactionDate < today)
      ctx.addIssue({ code: 'custom', path: ['transactionDate'], message: 'A planned transaction must be today or later.' })
  })
type Values = z.infer<typeof schema>

export interface TransactionFormProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  defaultType?: TransactionType
  transaction?: TransactionDto
  onSaved?: (t: TransactionDto) => void
}

function defaults(type: TransactionType, t?: TransactionDto): Values {
  return {
    type: t?.type ?? type,
    description: t?.description ?? '',
    amount: t ? centsToRandInput(t.amountCents) : '',
    category: t?.category ?? '',
    transactionDate: t?.transactionDate ?? todayJhb(),
    paymentMethod: t?.paymentMethod ?? 'cash',
    paymentStatus: t && t.paymentStatus !== 'confirmed_external' ? t.paymentStatus : 'recorded_manually',
    status: t?.status === 'scheduled' ? 'scheduled' : 'posted',
    reference: t?.reference ?? '',
    notes: t?.notes ?? '',
    branchId: t?.branchId ?? '',
    lines: [],
  }
}

export function TransactionFormDialog({ open, onOpenChange, defaultType = 'income', transaction, onSaved }: TransactionFormProps) {
  const categories = useCategories()
  const save = useSaveTransaction()
  const { can } = useAccess()
  // Limited roles may only record posted sales and/or posted expenses (the API enforces this too).
  const limited = !can('manageFinancials')
  const canIncome = can('manageFinancials', 'recordSales')
  const canExpense = can('manageFinancials', 'recordExpenses')
  const salesOnly = limited && !canExpense
  const editing = !!transaction
  const startType: TransactionType = !canIncome ? 'expense' : !canExpense ? 'income' : defaultType
  const { register, handleSubmit, formState, control, reset, setValue, setError, getValues } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: defaults(startType, transaction),
  })
  const lineArray = useFieldArray({ control, name: 'lines' })
  const branches = useBranches()
  const activeBranches = useMemo(() => (branches.data ?? []).filter((b) => b.isActive), [branches.data])
  // One key per form opening; a retry of the same submission reuses it so the API never records the sale twice.
  const idemKey = useRef<string>(newIdempotencyKey())
  const [amountTouched, setAmountTouched] = useState(false)

  useEffect(() => {
    if (open) {
      reset(defaults(startType, transaction))
      idemKey.current = newIdempotencyKey()
      setAmountTouched(!!transaction)
    }
  }, [open, startType, transaction, reset])

  const type = useWatch({ control, name: 'type' })
  const status = useWatch({ control, name: 'status' })
  const category = useWatch({ control, name: 'category' })
  const lines = useWatch({ control, name: 'lines' })
  const showLines = !editing && type === 'income' && can('viewInventory')
  const products = useProducts({}, { enabled: open && showLines })
  const productList = useMemo(() => (products.data ?? []).filter((p) => p.isActive), [products.data])
  const suggestedCents = useMemo(() => {
    let total = 0
    for (const l of lines ?? []) {
      const p = productList.find((x) => x.id === l.productId)
      const q = Number.parseInt(l.quantity, 10)
      if (p && q > 0) total += p.unitPriceCents * q
    }
    return total
  }, [lines, productList])

  // Suggest the amount from the product lines until the person types their own amount.
  useEffect(() => {
    if (!amountTouched && suggestedCents > 0) setValue('amount', centsToRandInput(suggestedCents), { shouldValidate: false })
  }, [suggestedCents, amountTouched, setValue])
  const list = useMemo(() => (categories.data ? (type === 'income' ? categories.data.income : categories.data.expense) : []), [categories.data, type])

  useEffect(() => {
    if (list.length && category && !list.includes(category)) setValue('category', '')
  }, [list, category, setValue])

  const e = formState.errors

  const submit = handleSubmit(async (v) => {
    const validLines = showLines ? v.lines.filter((l) => l.productId) : []
    const branchId = v.branchId || (activeBranches.length === 1 ? activeBranches[0].id : '')
    if (!editing && validLines.length > 0 && activeBranches.length > 1 && !branchId) {
      setError('branchId', { type: 'manual', message: 'Choose a branch so the stock can be reduced there.' })
      return
    }
    try {
      const saved = await save.mutateAsync({
        id: transaction?.id,
        idempotencyKey: editing ? undefined : idemKey.current,
        input: {
          type: v.type,
          description: v.description.trim(),
          amountCents: parseRandToCents(v.amount) ?? 0,
          category: v.category,
          transactionDate: v.transactionDate,
          paymentMethod: v.paymentMethod,
          paymentStatus: v.paymentStatus,
          status: v.status,
          reference: nullIfEmpty(v.reference),
          notes: nullIfEmpty(v.notes),
          ...(editing
            ? {}
            : {
                branchId: branchId || null,
                lineItems: validLines.length ? validLines.map((l) => ({ productId: l.productId, quantity: Number.parseInt(l.quantity, 10) })) : undefined,
              }),
        },
      })
      toast.success(editing ? 'Transaction updated' : v.type === 'income' ? 'Sale recorded' : 'Expense recorded')
      onSaved?.(saved)
      onOpenChange(false)
    } catch (err) {
      handleFormError(err, setError, {
        type: 'type',
        description: 'description',
        amountCents: 'amount',
        category: 'category',
        transactionDate: 'transactionDate',
        paymentMethod: 'paymentMethod',
        paymentStatus: 'paymentStatus',
        status: 'status',
        reference: 'reference',
        notes: 'notes',
        branchId: 'branchId',
        lineItems: 'lines',
      })
    }
  })

  const today = todayJhb()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit transaction' : salesOnly ? 'Record a sale' : limited && !canIncome ? 'Record an expense' : type === 'income' ? 'Record income' : 'Record expense'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Changes update your reports and forecast.' : 'Money in or out of the business. It updates your cash balance and forecast.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-5">
            {canIncome && canExpense && (
            <div role="radiogroup" aria-label="Transaction type" className="grid grid-cols-2 gap-2 rounded-lg bg-paper p-1">
              {(['income', 'expense'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={type === t}
                  onClick={() => setValue('type', t, { shouldDirty: true })}
                  className={cn(
                    'flex cursor-pointer items-center justify-center gap-2 rounded-md py-2.5 text-sm font-semibold transition-colors',
                    type === t
                      ? t === 'income'
                        ? 'bg-primary text-primary-fg shadow-card'
                        : 'bg-surface text-ink shadow-card ring-1 ring-line-strong'
                      : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {t === 'income' ? <ArrowDownLeft className="size-4" aria-hidden /> : <ArrowUpRight className="size-4" aria-hidden />}
                  {t === 'income' ? 'Income' : 'Expense'}
                  <span className="hidden font-normal opacity-80 sm:inline">{t === 'income' ? '(money in)' : '(money out)'}</span>
                </button>
              ))}
            </div>
            )}

            {!editing && activeBranches.length > 1 && (
              <Field id="tx-branch" label="Branch" error={e.branchId?.message} hint={lines?.length ? 'Stock is reduced at this branch.' : undefined}>
                <NativeSelect {...register('branchId')}>
                  <option value="">{salesOnly ? 'Choose your branch' : 'Choose a branch'}</option>
                  {activeBranches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}

            {showLines && (
              <fieldset className="min-w-0 rounded-lg border border-line p-3">
                <legend className="px-1 text-sm font-medium">
                  Products sold <span className="font-normal text-ink-muted">(optional)</span>
                </legend>
                <p className="text-[13px] text-ink-muted">Adding products reduces stock. The amount is suggested from the prices, but you can change it.</p>
                {lineArray.fields.length > 0 && (
                  <ul className="mt-3 space-y-2">
                    {lineArray.fields.map((f, i) => (
                      <li key={f.id} className="grid min-w-0 grid-cols-[minmax(0,1fr)_4.5rem_auto] items-start gap-2">
                        <div className="min-w-0">
                          <label htmlFor={`tx-line-${i}-p`} className="sr-only">
                            Product {i + 1}
                          </label>
                          <NativeSelect id={`tx-line-${i}-p`} aria-invalid={e.lines?.[i]?.productId ? true : undefined} {...register(`lines.${i}.productId`)}>
                            <option value="">Choose a product</option>
                            {productList.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name} · {formatZAR(p.unitPriceCents)}
                                {p.kind === 'product' ? ` · ${p.totalQuantity} in stock` : ''}
                              </option>
                            ))}
                          </NativeSelect>
                          {e.lines?.[i]?.productId && <p className="mt-1 text-[12px] font-medium text-red-700">{e.lines[i]?.productId?.message}</p>}
                        </div>
                        <div>
                          <label htmlFor={`tx-line-${i}-q`} className="sr-only">
                            Quantity {i + 1}
                          </label>
                          <Input id={`tx-line-${i}-q`} inputMode="numeric" aria-invalid={e.lines?.[i]?.quantity ? true : undefined} {...register(`lines.${i}.quantity`)} />
                          {e.lines?.[i]?.quantity && <p className="mt-1 text-[12px] font-medium text-red-700">{e.lines[i]?.quantity?.message}</p>}
                        </div>
                        <Button type="button" size="icon" variant="ghost" aria-label={`Remove product ${i + 1}`} onClick={() => lineArray.remove(i)}>
                          <Trash2 />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <Button type="button" size="sm" variant="secondary" disabled={products.isLoading || productList.length === 0} onClick={() => lineArray.append({ productId: '', quantity: '1' })}>
                    <PackagePlus /> Add product
                  </Button>
                  {productList.length === 0 && !products.isLoading && <span className="text-[13px] text-ink-muted">No products set up yet.</span>}
                  {suggestedCents > 0 && (
                    <span className="text-[13px] text-ink-soft">
                      Products total {formatZAR(suggestedCents)}
                      {amountTouched && parseRandToCents(getValues('amount')) !== suggestedCents && (
                        <Button
                          type="button"
                          variant="link"
                          size="sm"
                          className="ml-1 h-auto"
                          onClick={() => {
                            setValue('amount', centsToRandInput(suggestedCents), { shouldValidate: true })
                            setAmountTouched(false)
                          }}
                        >
                          Use this amount
                        </Button>
                      )}
                    </span>
                  )}
                </div>
              </fieldset>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="tx-amount" label="Amount" error={e.amount?.message}>
                <MoneyInput autoFocus {...register('amount', { onChange: () => setAmountTouched(true) })} />
              </Field>
              <Field id="tx-category" label="Category" error={e.category?.message ?? (categories.isError ? 'Could not load categories.' : undefined)}>
                <NativeSelect {...register('category')} disabled={categories.isLoading}>
                  <option value="">{categories.isLoading ? 'Loading…' : 'Choose a category'}</option>
                  {list.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="tx-desc" label="Description" error={e.description?.message} className="sm:col-span-2">
                <Input placeholder={type === 'income' ? 'e.g. Bread and airtime sales' : 'e.g. Stock from wholesaler'} {...register('description')} />
              </Field>
            </div>

            {!limited && (
            <fieldset>
              <legend className="text-sm font-medium">Has this happened yet?</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                <label className="flex cursor-pointer gap-2.5 rounded-md border border-line-strong p-3 text-sm has-[:checked]:border-forest-800 has-[:checked]:bg-forest-50">
                  <input type="radio" value="posted" className="mt-0.5 accent-forest-800" {...register('status')} />
                  <span>
                    <span className="font-semibold">Yes, it happened</span>
                    <span className="block text-[13px] text-ink-muted">Counts in your cash balance now.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer gap-2.5 rounded-md border border-line-strong p-3 text-sm has-[:checked]:border-forest-800 has-[:checked]:bg-forest-50">
                  <input type="radio" value="scheduled" className="mt-0.5 accent-forest-800" {...register('status')} />
                  <span>
                    <span className="font-semibold">No, it is planned</span>
                    <span className="block text-[13px] text-ink-muted">Only used in the cash forecast.</span>
                  </span>
                </label>
              </div>
            </fieldset>
            )}

            <div className="grid gap-5 sm:grid-cols-2">
              <Field id="tx-date" label={status === 'scheduled' ? 'Planned date' : 'Date'} error={e.transactionDate?.message}>
                <Input type="date" {...(status === 'posted' ? { max: today } : { min: today })} {...register('transactionDate')} />
              </Field>
              <Field id="tx-method" label="Payment method" error={e.paymentMethod?.message}>
                <NativeSelect {...register('paymentMethod')}>
                  {entries(PAYMENT_METHODS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {!limited && (
              <Field
                id="tx-pstatus"
                label="Payment status"
                hint="Use “Awaiting confirmation” until you have seen the money in your bank app, not just a screenshot or SMS."
                error={e.paymentStatus?.message}
                className="sm:col-span-2"
              >
                <NativeSelect {...register('paymentStatus')}>
                  {statusKeys.map((k) => (
                    <option key={k} value={k}>
                      {PAYMENT_STATUS[k]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              )}
              <Field id="tx-ref" label="Reference" optional error={e.reference?.message}>
                <Input placeholder="Slip or invoice number" {...register('reference')} />
              </Field>
              <Field id="tx-notes" label="Notes" optional error={e.notes?.message} className="sm:col-span-2">
                <Textarea rows={2} {...register('notes')} />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={formState.isSubmitting}>
              {editing ? 'Save changes' : type === 'income' ? 'Record income' : 'Record expense'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
