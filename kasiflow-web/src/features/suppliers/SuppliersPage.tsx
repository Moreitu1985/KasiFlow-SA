import { useState } from 'react'
import { BankDetailsDialog } from './BankDetailsDialog'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Pencil, Plus, Receipt, Search, Truck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAccess } from '@/features/access/useAccess'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox, Input, NativeSelect } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { RoleHeader } from '@/features/access/RoleHeader'
import { KpiCard } from '@/components/shared/KpiCard'
import { Money } from '@/components/shared/Money'
import { Pagination } from '@/components/shared/Pagination'
import { CardsSkeleton, EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { ContactFormDialog } from '@/features/customers/ContactFormDialog'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PayableDto, PayableStatus, SupplierDto } from '@/types/api'
import { usePayableSummary, usePayables, useSaveSupplier, useSuppliers } from './api'
import { AddBillDialog } from './AddBillDialog'

export function PayableStatusBadge({ p }: { p: Pick<PayableDto, 'status' | 'isOverdue' | 'daysUntilDue'> }) {
  if (p.status === 'open' && p.isOverdue) return <Badge variant="critical">Overdue</Badge>
  if (p.status === 'open' && p.daysUntilDue <= 7) return <Badge variant="warning">{p.daysUntilDue === 0 ? 'Due today' : `Due in ${p.daysUntilDue} days`}</Badge>
  if (p.status === 'open') return <Badge variant="info">Open</Badge>
  if (p.status === 'paid') return <Badge variant="success">Paid</Badge>
  return <Badge variant="neutral">Cancelled</Badge>
}

export function BillsTab({ onAddBill }: { onAddBill: () => void }) {
  const canEdit = useAccess().can('manageFinancials')
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const filter = (params.get('filter') as 'all' | 'overdue' | 'due_soon' | null) ?? 'all'
  const status = (params.get('status') as PayableStatus | 'all' | null) ?? 'open'
  const supplierId = params.get('supplier') ?? ''
  const page = Number(params.get('page') ?? '1') || 1
  const summary = usePayableSummary()
  const list = usePayables({ filter, status, supplierId: supplierId || undefined, page, pageSize: 20 })
  const suppliers = useSuppliers()

  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  return (
    <div className="space-y-6">
      {summary.isLoading ? (
        <CardsSkeleton />
      ) : summary.isError ? (
        <ErrorState error={summary.error} onRetry={() => summary.refetch()} />
      ) : summary.data ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard label="Total you owe" value={<Money cents={summary.data.totalOutstandingCents} />} note={`${summary.data.openCount} open bills`} definition="Unpaid balance of all open supplier bills." />
          <KpiCard label="Overdue" value={<Money cents={summary.data.overdueCents} />} tone={summary.data.overdueCents > 0 ? 'critical' : 'default'} definition="Unpaid balance of bills whose due date has passed." />
          <KpiCard label="Due in next 7 days" value={<Money cents={summary.data.dueNext7DaysCents} />} tone={summary.data.dueNext7DaysCents > 0 ? 'warning' : 'default'} definition="Unpaid balance of bills due in the next 7 days." />
          <KpiCard label="Due in next 30 days" value={<Money cents={summary.data.dueNext30DaysCents} />} definition="Unpaid balance of bills due in the next 30 days." />
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div role="group" aria-label="Due date filter" className="flex rounded-md border border-line-strong bg-surface p-0.5">
          {(['all', 'overdue', 'due_soon'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => set({ filter: f === 'all' ? '' : f })}
              className={cn('cursor-pointer rounded px-3 py-1.5 text-[13px] font-semibold', filter === f ? 'bg-primary text-primary-fg' : 'text-ink-soft hover:bg-forest-50')}
            >
              {f === 'all' ? 'All' : f === 'overdue' ? 'Overdue' : 'Due in 7 days'}
            </button>
          ))}
        </div>
        <div>
          <Label htmlFor="p-status" className="sr-only">Status</Label>
          <NativeSelect id="p-status" className="h-9 sm:w-40" value={status} onChange={(e) => set({ status: e.target.value })}>
            <option value="open">Open</option>
            <option value="paid">Paid</option>
            <option value="cancelled">Cancelled</option>
            <option value="all">All statuses</option>
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="p-supplier" className="sr-only">Supplier</Label>
          <NativeSelect id="p-supplier" className="h-9 sm:w-52" value={supplierId} onChange={(e) => set({ supplier: e.target.value })}>
            <option value="">All suppliers</option>
            {suppliers.data?.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </NativeSelect>
        </div>
      </div>

      {list.isLoading ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.items.length ? (
        <EmptyState
          icon={Receipt}
          title={filter === 'all' && status === 'open' && !supplierId ? 'No open supplier bills' : 'No bills match these filters'}
          description="Add bills from wholesalers and service providers so KasiFlow can warn you before they fall due."
          action={canEdit ? <Button onClick={onAddBill}><Plus /> Add a bill</Button> : undefined}
        />
      ) : (
        <div>
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface md:hidden">
            {list.data.items.map((p) => (
              <Link key={p.id} to={`/suppliers/bills/${p.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-paper">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{p.supplierName}</p>
                  <p className="truncate text-[13px] text-ink-muted">{p.description}</p>
                  <p className="text-[13px] text-ink-muted">Due {formatDate(p.dueDate)}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Money cents={p.remainingCents} className="text-sm font-semibold" />
                  <PayableStatusBadge p={p} />
                </div>
              </Link>
            ))}
          </div>
          <div className="hidden overflow-hidden rounded-lg border border-line bg-surface md:block">
            <Table>
              <THead>
                <TR>
                  <TH>Supplier</TH>
                  <TH>Description</TH>
                  <TH>Category</TH>
                  <TH>Due</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Bill</TH>
                  <TH className="text-right">Still to pay</TH>
                </TR>
              </THead>
              <TBody>
                {list.data.items.map((p) => (
                  <TR key={p.id} className="cursor-pointer hover:bg-paper" onClick={() => navigate(`/suppliers/bills/${p.id}`)}>
                    <TD>
                      <Link to={`/suppliers/bills/${p.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
                        {p.supplierName}
                      </Link>
                    </TD>
                    <TD className="max-w-60 truncate text-ink-soft">{p.description}</TD>
                    <TD className="text-ink-soft">{p.category}</TD>
                    <TD className="whitespace-nowrap text-ink-soft">{formatDate(p.dueDate)}</TD>
                    <TD><PayableStatusBadge p={p} /></TD>
                    <TD className="text-right text-ink-soft"><Money cents={p.originalAmountCents} /></TD>
                    <TD className="text-right font-semibold"><Money cents={p.remainingCents} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <Pagination page={list.data.page} totalPages={list.data.totalPages} totalCount={list.data.totalCount} onPage={(pg) => set({ page: String(pg) })} />
        </div>
      )}
    </div>
  )
}

function SuppliersTab({ onAdd, onEdit, onAddBill }: { onAdd: () => void; onEdit: (s: SupplierDto) => void; onAddBill: (id: string) => void }) {
  const canEdit = useAccess().can('manageFinancials')
  const [bankFor, setBankFor] = useState<SupplierDto | null>(null)
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const list = useSuppliers(search.trim(), archived)
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input aria-label="Search suppliers" className="pl-9" placeholder="Search suppliers" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={archived} onChange={(e) => setArchived(e.target.checked)} /> Show archived
        </label>
      </div>
      {list.isLoading ? (
        <ListSkeleton />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data?.length ? (
        <EmptyState icon={Truck} title={search ? 'No suppliers match' : 'No suppliers yet'} description="Add the wholesalers and service providers you buy from." action={canEdit ? <Button onClick={onAdd}><Plus /> Add supplier</Button> : undefined} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((s) => (
            <Card key={s.id} className={s.isArchived ? 'opacity-70' : undefined}>
              <CardHeader className="flex-row items-start justify-between pb-2">
                <div className="min-w-0">
                  <CardTitle className="truncate font-sans">{s.name}</CardTitle>
                  <p className="truncate text-[13px] text-ink-muted">{[s.phone, s.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
                </div>
                {canEdit && (
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={() => onEdit(s)}>
                    <Pencil />
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex items-end justify-between gap-2">
                <div>
                  <p className="text-[13px] text-ink-muted">You owe</p>
                  <Money cents={s.outstandingCents} className="text-lg font-semibold" />
                  <p className="text-[13px] text-ink-muted">{s.openBills} open {s.openBills === 1 ? 'bill' : 'bills'}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {s.isArchived && <Badge>Archived</Badge>}
                  {canEdit && (
                    <Button size="sm" variant="outline" onClick={() => onAddBill(s.id)}>
                      <Plus /> Bill
                    </Button>
                  )}
                  {s.openBills > 0 && (
                    <Link to={`/suppliers?supplier=${s.id}`} className="text-[13px] font-semibold text-forest-800 hover:underline">
                      View bills
                    </Link>
                  )}
                  <button type="button" onClick={() => setBankFor(s)} className="cursor-pointer text-[13px] font-semibold text-forest-800 hover:underline">
                    Bank details
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
      <BankDetailsDialog supplier={bankFor} onOpenChange={(o) => !o && setBankFor(null)} />
    </div>
  )
}

export function SuppliersPage() {
  const canEdit = useAccess().can('manageFinancials')
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'suppliers' ? 'suppliers' : 'bills'
  const [billOpen, setBillOpen] = useState(false)
  const [preset, setPreset] = useState<string>()
  const [contactOpen, setContactOpen] = useState(false)
  const [editing, setEditing] = useState<SupplierDto>()
  const save = useSaveSupplier()

  const openBill = (id?: string) => {
    setPreset(id)
    setBillOpen(true)
  }
  const openContact = (s?: SupplierDto) => {
    setEditing(s)
    setContactOpen(true)
  }

  return (
    <div>
      <RoleHeader
        title="Suppliers & bills"
        description="Know what you owe and when it is due, so stock payments never catch you short."
        actions={
          canEdit && (
            <>
              <Button variant="outline" onClick={() => openContact()}>
                <Plus /> Supplier
              </Button>
              <Button onClick={() => openBill()}>
                <Plus /> Add bill
              </Button>
            </>
          )
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams()
          if (v === 'suppliers') next.set('tab', 'suppliers')
          setParams(next, { replace: true })
        }}
      >
        <TabsList>
          <TabsTrigger value="bills">Bills to pay</TabsTrigger>
          <TabsTrigger value="suppliers">Suppliers</TabsTrigger>
        </TabsList>
        <TabsContent value="bills">
          <BillsTab onAddBill={() => openBill()} />
        </TabsContent>
        <TabsContent value="suppliers">
          <SuppliersTab onAdd={() => openContact()} onEdit={openContact} onAddBill={openBill} />
        </TabsContent>
      </Tabs>
      <AddBillDialog open={billOpen} onOpenChange={setBillOpen} presetSupplierId={preset} onAddSupplier={() => openContact()} />
      <ContactFormDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        kind="supplier"
        contact={editing}
        onSubmit={async (input) => {
          const s = await save.mutateAsync({ id: editing?.id, input })
          toast.success(editing ? 'Supplier updated' : 'Supplier added')
          if (!editing) setPreset(s.id)
        }}
      />
    </div>
  )
}
