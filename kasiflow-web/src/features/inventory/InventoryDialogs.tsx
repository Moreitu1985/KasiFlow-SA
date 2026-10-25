import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, NativeSelect, Textarea } from '@/components/ui/input'
import { Callout } from '@/components/shared/Callout'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { History } from 'lucide-react'
import { api, ApiError, errorMessage } from '@/lib/apiClient'
import { centsToRandInput, formatDateTime, humanize, parseRandToCents } from '@/lib/format'
import { useBizKey, useBizReady } from '@/hooks/useBizQuery'
import { useAccess } from '@/features/access/useAccess'
import type { SupplierDto } from '@/types/api'
import type { BranchDto, ProductDto } from '@/types/automation'
import { useAdjustStock, useMovements, useReceiveStock, useSaveProduct, useTransferStock } from './api'

type Errors = Record<string, string>

function fromApi(err: unknown, fallback: string, setErrors: (e: Errors) => void) {
  if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])))
  else toast.error(fallback, { description: errorMessage(err) })
}

function int(v: string): number | null {
  const t = v.trim()
  if (!/^-?\d+$/.test(t)) return null
  return Number.parseInt(t, 10)
}

function Footer({ onCancel, pending, label }: { onCancel: () => void; pending: boolean; label: string }) {
  return (
    <DialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        Cancel
      </Button>
      <Button type="submit" loading={pending}>
        {label}
      </Button>
    </DialogFooter>
  )
}

function BranchSelect({ id, label, branches, value, onChange, error, exclude }: { id: string; label: string; branches: BranchDto[]; value: string; onChange: (v: string) => void; error?: string; exclude?: string }) {
  return (
    <Field id={id} label={label} error={error}>
      <NativeSelect value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a branch</option>
        {branches
          .filter((b) => b.isActive && b.id !== exclude)
          .map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
      </NativeSelect>
    </Field>
  )
}

export function ProductDialog({ product, open, onOpenChange }: { product: ProductDto | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  const save = useSaveProduct()
  const key = useBizKey()
  const { can } = useAccess()
  const suppliers = useQuery({
    queryKey: key('suppliers', 'for-products'),
    queryFn: () => api.get<SupplierDto[]>('/api/suppliers'),
    enabled: useBizReady() && open && can('viewFinancials'),
  })
  const [v, setV] = useState({
    sku: product?.sku ?? '',
    barcode: product?.barcode ?? '',
    name: product?.name ?? '',
    kind: product?.kind ?? 'product',
    price: product ? centsToRandInput(product.unitPriceCents) : '',
    cost: product ? centsToRandInput(product.unitCostCents) : '',
    minStock: String(product?.minStockQty ?? 0),
    leadTime: product?.leadTimeDays != null ? String(product.leadTimeDays) : '',
    supplierId: product?.supplierId ?? '',
    isActive: product?.isActive ?? true,
  })
  const [errors, setErrors] = useState<Errors>({})
  const set = (patch: Partial<typeof v>) => setV((s) => ({ ...s, ...patch }))

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const errs: Errors = {}
    const price = parseRandToCents(v.price)
    const cost = v.cost.trim() === '' ? 0 : parseRandToCents(v.cost)
    const minStock = int(v.minStock || '0')
    const lead = v.leadTime.trim() === '' ? null : int(v.leadTime)
    if (!/^[A-Za-z0-9._-]{1,40}$/.test(v.sku.trim())) errs.sku = "Use 1–40 letters, numbers, '.', '-' or '_'."
    if (v.barcode.trim() && !/^\d{6,14}$/.test(v.barcode.trim())) errs.barcode = 'A barcode is 6–14 digits.'
    if (!v.name.trim()) errs.name = 'Enter a product name.'
    if (price === null) errs.unitPriceCents = 'Enter a selling price, like 25 or 25.50.'
    if (cost === null) errs.unitCostCents = 'Enter a cost price, or leave it empty.'
    if (minStock === null || minStock < 0) errs.minStockQty = 'Enter a whole number from 0.'
    if (v.leadTime.trim() && (lead === null || lead < 0 || lead > 120)) errs.leadTimeDays = 'Use 0–120 days.'
    setErrors(errs)
    if (Object.keys(errs).length) return
    save.mutate(
      {
        id: product?.id,
        input: {
          sku: v.sku.trim(),
          barcode: v.barcode.trim() || null,
          name: v.name.trim(),
          kind: v.kind as 'product' | 'service',
          unitPriceCents: price!,
          unitCostCents: cost,
          minStockQty: minStock,
          leadTimeDays: lead,
          supplierId: v.supplierId || null,
          isActive: v.isActive,
        },
      },
      {
        onSuccess: () => {
          toast.success(product ? 'Product saved' : 'Product added')
          onOpenChange(false)
        },
        onError: (err) => fromApi(err, 'Could not save the product', setErrors),
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{product ? 'Edit product' : 'Add product'}</DialogTitle>
            <DialogDescription>Stock levels change through receiving, sales, adjustments and transfers, not here.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5 sm:grid-cols-2">
            <Field id="p-name" label="Name" error={errors.name} className="sm:col-span-2">
              <Input value={v.name} onChange={(e) => set({ name: e.target.value })} maxLength={120} />
            </Field>
            <Field id="p-sku" label="SKU / code" error={errors.sku}>
              <Input value={v.sku} onChange={(e) => set({ sku: e.target.value })} maxLength={40} autoCapitalize="characters" />
            </Field>
            <Field id="p-barcode" label="Barcode" optional error={errors.barcode}>
              <Input inputMode="numeric" value={v.barcode} onChange={(e) => set({ barcode: e.target.value })} maxLength={14} />
            </Field>
            <Field id="p-kind" label="Type" error={errors.kind}>
              <NativeSelect value={v.kind} onChange={(e) => set({ kind: e.target.value as 'product' | 'service' })}>
                <option value="product">Product (has stock)</option>
                <option value="service">Service (no stock)</option>
              </NativeSelect>
            </Field>
            <Field id="p-price" label="Selling price" error={errors.unitPriceCents}>
              <MoneyInput value={v.price} onChange={(e) => set({ price: e.target.value })} />
            </Field>
            <Field id="p-cost" label="Cost price" optional error={errors.unitCostCents}>
              <MoneyInput value={v.cost} onChange={(e) => set({ cost: e.target.value })} />
            </Field>
            <Field id="p-min" label="Minimum stock" error={errors.minStockQty} hint="Low-stock alerts start at this level.">
              <Input type="number" inputMode="numeric" min={0} value={v.minStock} onChange={(e) => set({ minStock: e.target.value })} />
            </Field>
            <Field id="p-lead" label="Supplier lead time (days)" optional error={errors.leadTimeDays}>
              <Input type="number" inputMode="numeric" min={0} max={120} value={v.leadTime} onChange={(e) => set({ leadTime: e.target.value })} />
            </Field>
            {can('viewFinancials') && (
              <Field id="p-supplier" label="Supplier" optional error={errors.supplierId}>
                <NativeSelect value={v.supplierId} onChange={(e) => set({ supplierId: e.target.value })}>
                  <option value="">No supplier</option>
                  {(suppliers.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            {product && (
              <label className="flex items-center gap-2.5 text-sm sm:col-span-2">
                <Checkbox checked={v.isActive} onChange={(e) => set({ isActive: e.target.checked })} /> Active (shown in sales and stock lists)
              </label>
            )}
          </DialogBody>
          <Footer onCancel={() => onOpenChange(false)} pending={save.isPending} label={product ? 'Save product' : 'Add product'} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function ReceiveDialog({ product, branches, onOpenChange }: { product: ProductDto | null; branches: BranchDto[]; onOpenChange: (o: boolean) => void }) {
  const receive = useReceiveStock()
  const active = branches.filter((b) => b.isActive)
  const [branchId, setBranchId] = useState(active.length === 1 ? active[0].id : '')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState(product ? centsToRandInput(product.unitCostCents) : '')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            if (!product) return
            const q = int(qty)
            const c = cost.trim() === '' ? null : parseRandToCents(cost)
            const errs: Errors = {}
            if (!branchId) errs.branchId = 'Choose the branch receiving the stock.'
            if (q === null || q < 1) errs.quantity = 'Enter how many units arrived.'
            if (cost.trim() && c === null) errs.unitCostCents = 'Enter a cost like 12.50.'
            setErrors(errs)
            if (Object.keys(errs).length) return
            receive.mutate(
              { productId: product.id, branchId, quantity: q!, unitCostCents: c, note: note.trim() || null },
              { onSuccess: () => (toast.success('Stock received'), onOpenChange(false)), onError: (err) => fromApi(err, 'Could not receive stock', setErrors) },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>Receive stock</DialogTitle>
            <DialogDescription>{product?.name}: goods that arrived from a supplier. Record the bill under Suppliers if you owe money for it.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5 sm:grid-cols-2">
            <BranchSelect id="rc-branch" label="Branch" branches={branches} value={branchId} onChange={setBranchId} error={errors.branchId} />
            <Field id="rc-qty" label="Quantity" error={errors.quantity}>
              <Input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field id="rc-cost" label="Cost per unit" optional error={errors.unitCostCents}>
              <MoneyInput value={cost} onChange={(e) => setCost(e.target.value)} />
            </Field>
            <Field id="rc-note" label="Note" optional error={errors.note} className="sm:col-span-2">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </Field>
          </DialogBody>
          <Footer onCancel={() => onOpenChange(false)} pending={receive.isPending} label="Receive stock" />
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function AdjustDialog({ product, branches, onOpenChange }: { product: ProductDto | null; branches: BranchDto[]; onOpenChange: (o: boolean) => void }) {
  const adjust = useAdjustStock()
  const { can } = useAccess()
  const active = branches.filter((b) => b.isActive)
  const [branchId, setBranchId] = useState(active.length === 1 ? active[0].id : '')
  const [type, setType] = useState('adjustment')
  const [qty, setQty] = useState('')
  const [reason, setReason] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const needsApproval = !can('approveStockAdjustment')
  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            if (!product) return
            const q = int(qty)
            const errs: Errors = {}
            if (!branchId) errs.branchId = 'Choose the branch.'
            if (q === null || q === 0) errs.quantityDelta = 'Enter units to add (e.g. 3) or remove (e.g. -2).'
            else if (type === 'damaged' && q > 0) errs.quantityDelta = 'Damaged stock is removed, so use a negative number.'
            else if (type === 'return' && q < 0) errs.quantityDelta = 'Returned stock comes back, so use a positive number.'
            if (reason.trim().length < 3) errs.reason = 'Give a short reason.'
            setErrors(errs)
            if (Object.keys(errs).length) return
            adjust.mutate(
              { productId: product.id, branchId, type, quantityDelta: q!, reason: reason.trim() },
              {
                onSuccess: (m) => {
                  toast.success(m.status === 'pending_approval' ? 'Adjustment sent for approval' : 'Stock adjusted')
                  onOpenChange(false)
                },
                onError: (err) => fromApi(err, 'Could not save the adjustment', setErrors),
              },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>Adjust stock</DialogTitle>
            <DialogDescription>{product?.name}: correct a count, write off damaged stock or take back a customer return.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5 sm:grid-cols-2">
            {needsApproval && (
              <Callout tone="info" className="sm:col-span-2" title="Needs approval">
                A manager must approve this adjustment before stock levels change.
              </Callout>
            )}
            <BranchSelect id="ad-branch" label="Branch" branches={branches} value={branchId} onChange={setBranchId} error={errors.branchId} />
            <Field id="ad-type" label="Type" error={errors.type}>
              <NativeSelect value={type} onChange={(e) => setType(e.target.value)}>
                <option value="adjustment">Count correction</option>
                <option value="damaged">Damaged / expired (remove)</option>
                <option value="return">Customer return (add back)</option>
              </NativeSelect>
            </Field>
            <Field id="ad-qty" label="Change in units" error={errors.quantityDelta} hint="Positive adds stock, negative removes it." className="sm:col-span-2">
              <Input inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="e.g. -2" />
            </Field>
            <Field id="ad-reason" label="Reason" error={errors.reason} className="sm:col-span-2">
              <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={300} />
            </Field>
          </DialogBody>
          <Footer onCancel={() => onOpenChange(false)} pending={adjust.isPending} label={needsApproval ? 'Send for approval' : 'Save adjustment'} />
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function TransferDialog({ product, branches, onOpenChange }: { product: ProductDto | null; branches: BranchDto[]; onOpenChange: (o: boolean) => void }) {
  const transfer = useTransferStock()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  const [errors, setErrors] = useState<Errors>({})
  const onHand = product?.levels.find((l) => l.branchId === from)?.quantity
  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            if (!product) return
            const q = int(qty)
            const errs: Errors = {}
            if (!from) errs.fromBranchId = 'Choose where the stock comes from.'
            if (!to) errs.toBranchId = 'Choose where it goes.'
            else if (to === from) errs.toBranchId = 'Choose a different branch.'
            if (q === null || q < 1) errs.quantity = 'Enter how many units to move.'
            setErrors(errs)
            if (Object.keys(errs).length) return
            transfer.mutate(
              { productId: product.id, fromBranchId: from, toBranchId: to, quantity: q!, note: note.trim() || null },
              { onSuccess: () => (toast.success('Stock transferred'), onOpenChange(false)), onError: (err) => fromApi(err, 'Could not transfer', setErrors) },
            )
          }}
        >
          <DialogHeader>
            <DialogTitle>Transfer stock</DialogTitle>
            <DialogDescription>{product?.name}: move units from one branch to another.</DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-5 sm:grid-cols-2">
            <BranchSelect id="tr-from" label="From branch" branches={branches} value={from} onChange={setFrom} error={errors.fromBranchId} />
            <BranchSelect id="tr-to" label="To branch" branches={branches} value={to} onChange={setTo} error={errors.toBranchId} exclude={from} />
            <Field id="tr-qty" label="Quantity" error={errors.quantity} hint={onHand !== undefined ? `${onHand} on hand at the sending branch.` : undefined}>
              <Input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
            <Field id="tr-note" label="Note" optional className="sm:col-span-2">
              <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
            </Field>
          </DialogBody>
          <Footer onCancel={() => onOpenChange(false)} pending={transfer.isPending} label="Transfer" />
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function MovementsDialog({ product, onOpenChange }: { product: ProductDto | null; onOpenChange: (o: boolean) => void }) {
  const q = useMovements({ productId: product?.id }, !!product)
  return (
    <Dialog open={!!product} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <DialogHeader>
          <DialogTitle>Stock history</DialogTitle>
          <DialogDescription>{product?.name} · latest 200 movements</DialogDescription>
        </DialogHeader>
        <DialogBody>
          {q.isLoading ? (
            <ListSkeleton rows={4} />
          ) : q.isError ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : !q.data?.length ? (
            <EmptyState icon={History} title="No movements yet" />
          ) : (
            <ol className="divide-y divide-line rounded-lg border border-line">
              {q.data.map((m) => (
                <li key={m.id} className="flex items-start gap-3 px-3 py-2.5">
                  <span className={`w-12 shrink-0 text-right font-semibold tabular ${m.quantityDelta < 0 ? 'text-red-700' : 'text-emerald-800'}`}>
                    {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-1.5 text-sm font-medium">
                      {humanize(m.movementType)}
                      <Badge variant="outline">{m.source}</Badge>
                      {m.status !== 'applied' && <Badge variant={m.status === 'rejected' ? 'neutral' : 'warning'}>{humanize(m.status)}</Badge>}
                    </p>
                    <p className="text-[12px] text-ink-muted">
                      {m.branchName} · {formatDateTime(m.createdAt)}
                      {m.createdByName ? ` · ${m.createdByName}` : ''}
                    </p>
                    {m.reason && <p className="text-[13px] break-words text-ink-soft">{m.reason}</p>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
