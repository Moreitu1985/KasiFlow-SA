import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { HandCoins, Pencil, Plus, Search, Users } from 'lucide-react'
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
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CustomerDto, ReceivableDto, ReceivableStatus } from '@/types/api'
import { useCustomers, useReceivableSummary, useReceivables, useSaveCustomer } from './api'
import { AddDebtDialog } from './AddDebtDialog'
import { ContactFormDialog } from './ContactFormDialog'


export function ReceivableStatusBadge({ r }: { r: Pick<ReceivableDto, 'status' | 'isOverdue' | 'daysOverdue'> }) {
  if (r.status === 'open' && r.isOverdue) return <Badge variant="critical">{r.daysOverdue} days overdue</Badge>
  if (r.status === 'open') return <Badge variant="info">Open</Badge>
  if (r.status === 'settled') return <Badge variant="success">Settled</Badge>
  return <Badge variant="neutral">Written off</Badge>
}

export function DebtsTab({ onAddDebt }: { onAddDebt: () => void }) {
  const canEdit = useAccess().can('manageFinancials')
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const filter = (params.get('filter') as 'all' | 'overdue' | 'upcoming' | null) ?? 'all'
  const status = (params.get('status') as ReceivableStatus | 'all' | null) ?? 'open'
  const customerId = params.get('customer') ?? ''
  const page = Number(params.get('page') ?? '1') || 1
  const summary = useReceivableSummary()
  const list = useReceivables({ filter, status, customerId: customerId || undefined, page, pageSize: 20 })
  const customers = useCustomers()

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
          <KpiCard label="Total owed to you" value={<Money cents={summary.data.totalOutstandingCents} />} note={`${summary.data.openCount} open debts`} definition="The unpaid balance of all open customer debts." />
          <KpiCard
            label="Overdue"
            value={<Money cents={summary.data.overdueCents} />}
            tone={summary.data.overdueCents > 0 ? 'warning' : 'default'}
            definition="Unpaid balance of debts whose due date has passed."
          />
          <KpiCard label="Due in next 14 days" value={<Money cents={summary.data.upcomingCents} />} definition="Unpaid balance of debts due within the next 14 days." />
          <div className="rounded-lg border border-line bg-surface p-4 shadow-card sm:p-5">
            <p className="text-[13px] font-medium text-ink-muted">Top debtors</p>
            {summary.data.topDebtors.length === 0 ? (
              <p className="mt-2 text-sm text-ink-muted">Nobody owes you money.</p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {summary.data.topDebtors.slice(0, 4).map((d) => (
                  <li key={d.customerId} className="flex justify-between gap-2 text-sm">
                    <button type="button" className="cursor-pointer truncate text-left font-medium text-forest-800 hover:underline" onClick={() => set({ customer: d.customerId, status: 'open' })}>
                      {d.customerName}
                    </button>
                    <Money cents={d.outstandingCents} className="font-semibold" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div role="group" aria-label="Due date filter" className="flex rounded-md border border-line-strong bg-surface p-0.5">
          {(['all', 'overdue', 'upcoming'] as const).map((f) => (
            <button
              key={f}
              type="button"
              aria-pressed={filter === f}
              onClick={() => set({ filter: f === 'all' ? '' : f })}
              className={cn('cursor-pointer rounded px-3 py-1.5 text-[13px] font-semibold', filter === f ? 'bg-primary text-primary-fg' : 'text-ink-soft hover:bg-forest-50')}
            >
              {f === 'all' ? 'All' : f === 'overdue' ? 'Overdue' : 'Due in 14 days'}
            </button>
          ))}
        </div>
        <div>
          <Label htmlFor="r-status" className="sr-only">Status</Label>
          <NativeSelect id="r-status" className="h-9 sm:w-40" value={status} onChange={(e) => set({ status: e.target.value })}>
            <option value="open">Open</option>
            <option value="settled">Settled</option>
            <option value="written_off">Written off</option>
            <option value="all">All statuses</option>
          </NativeSelect>
        </div>
        <div>
          <Label htmlFor="r-customer" className="sr-only">Customer</Label>
          <NativeSelect id="r-customer" className="h-9 sm:w-52" value={customerId} onChange={(e) => set({ customer: e.target.value })}>
            <option value="">All customers</option>
            {customers.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
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
          icon={HandCoins}
          title={filter === 'all' && status === 'open' && !customerId ? 'No open customer debts' : 'No debts match these filters'}
          description="When a customer takes goods on credit, record it here so you can track and follow up."
          action={canEdit ? <Button onClick={onAddDebt}><Plus /> Record a debt</Button> : undefined}
        />
      ) : (
        <div>
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface md:hidden">
            {list.data.items.map((r) => (
              <Link key={r.id} to={`/debts/${r.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-paper">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{r.customerName}</p>
                  <p className="truncate text-[13px] text-ink-muted">{r.description}</p>
                  <p className="text-[13px] text-ink-muted">{r.dueDate ? `Due ${formatDate(r.dueDate)}` : 'No due date'}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Money cents={r.remainingCents} className="text-sm font-semibold" />
                  <ReceivableStatusBadge r={r} />
                </div>
              </Link>
            ))}
          </div>
          <div className="hidden overflow-hidden rounded-lg border border-line bg-surface md:block">
            <Table>
              <THead>
                <TR>
                  <TH>Customer</TH>
                  <TH>For</TH>
                  <TH>Given</TH>
                  <TH>Due</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Original</TH>
                  <TH className="text-right">Still owed</TH>
                </TR>
              </THead>
              <TBody>
                {list.data.items.map((r) => (
                  <TR key={r.id} className="cursor-pointer hover:bg-paper" onClick={() => navigate(`/debts/${r.id}`)}>
                    <TD>
                      <Link to={`/debts/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-medium hover:underline">
                        {r.customerName}
                      </Link>
                    </TD>
                    <TD className="max-w-60 truncate text-ink-soft">{r.description}</TD>
                    <TD className="whitespace-nowrap text-ink-soft">{formatDate(r.issueDate)}</TD>
                    <TD className="whitespace-nowrap text-ink-soft">{formatDate(r.dueDate)}</TD>
                    <TD><ReceivableStatusBadge r={r} /></TD>
                    <TD className="text-right text-ink-soft"><Money cents={r.originalAmountCents} /></TD>
                    <TD className="text-right font-semibold"><Money cents={r.remainingCents} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <Pagination page={list.data.page} totalPages={list.data.totalPages} totalCount={list.data.totalCount} onPage={(p) => set({ page: String(p) })} />
        </div>
      )}
    </div>
  )
}

function CustomersTab({ onAdd, onEdit, onAddDebt }: { onAdd: () => void; onEdit: (c: CustomerDto) => void; onAddDebt: (id: string) => void }) {
  const canEdit = useAccess().can('manageFinancials')
  const [search, setSearch] = useState('')
  const [archived, setArchived] = useState(false)
  const list = useCustomers(search.trim(), archived)
  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1 sm:max-w-sm">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
          <Input aria-label="Search customers" className="pl-9" placeholder="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} />
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
        <EmptyState icon={Users} title={search ? 'No customers match' : 'No customers yet'} description="Add customers who buy on credit so you can track what they owe." action={canEdit ? <Button onClick={onAdd}><Plus /> Add customer</Button> : undefined} />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.data.map((c) => (
            <Card key={c.id} className={c.isArchived ? 'opacity-70' : undefined}>
              <CardHeader className="flex-row items-start justify-between pb-2">
                <div className="min-w-0">
                  <CardTitle className="truncate font-sans">{c.name}</CardTitle>
                  <p className="truncate text-[13px] text-ink-muted">{[c.phone, c.email].filter(Boolean).join(' · ') || 'No contact details'}</p>
                </div>
                {canEdit && (
                  <Button size="icon-sm" variant="ghost" aria-label={`Edit ${c.name}`} onClick={() => onEdit(c)}>
                    <Pencil />
                  </Button>
                )}
              </CardHeader>
              <CardContent className="flex items-end justify-between gap-2">
                <div>
                  <p className="text-[13px] text-ink-muted">Owes you</p>
                  <Money cents={c.outstandingCents} className="text-lg font-semibold" />
                  <p className="text-[13px] text-ink-muted">{c.openDebts} open {c.openDebts === 1 ? 'debt' : 'debts'}</p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {c.isArchived && <Badge>Archived</Badge>}
                  {canEdit && (
                    <Button size="sm" variant="outline" onClick={() => onAddDebt(c.id)}>
                      <Plus /> Debt
                    </Button>
                  )}
                  {c.openDebts > 0 && (
                    <Link to={`/customers?customer=${c.id}`} className="text-[13px] font-semibold text-forest-800 hover:underline">
                      View debts
                    </Link>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

export function CustomersPage() {
  const canEdit = useAccess().can('manageFinancials')
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'customers' ? 'customers' : 'debts'
  const [debtOpen, setDebtOpen] = useState(false)
  const [presetCustomer, setPresetCustomer] = useState<string>()
  const [contactOpen, setContactOpen] = useState(false)
  const [editing, setEditing] = useState<CustomerDto>()
  const save = useSaveCustomer()

  const openDebt = (customerId?: string) => {
    setPresetCustomer(customerId)
    setDebtOpen(true)
  }
  const openContact = (c?: CustomerDto) => {
    setEditing(c)
    setContactOpen(true)
  }

  return (
    <div>
      <RoleHeader
        title="Customers & debts"
        description="Track who owes you money, follow up politely, and record payments as they come in."
        actions={
          canEdit && (
            <>
              <Button variant="outline" onClick={() => openContact()}>
                <Plus /> Customer
              </Button>
              <Button onClick={() => openDebt()}>
                <Plus /> Record debt
              </Button>
            </>
          )
        }
      />
      <Tabs
        value={tab}
        onValueChange={(v) => {
          const next = new URLSearchParams()
          if (v === 'customers') next.set('tab', 'customers')
          setParams(next, { replace: true })
        }}
      >
        <TabsList>
          <TabsTrigger value="debts">Money owed to you</TabsTrigger>
          <TabsTrigger value="customers">Customers</TabsTrigger>
        </TabsList>
        <TabsContent value="debts">
          <DebtsTab onAddDebt={() => openDebt()} />
        </TabsContent>
        <TabsContent value="customers">
          <CustomersTab onAdd={() => openContact()} onEdit={openContact} onAddDebt={openDebt} />
        </TabsContent>
      </Tabs>
      <AddDebtDialog
        open={debtOpen}
        onOpenChange={setDebtOpen}
        presetCustomerId={presetCustomer}
        onAddCustomer={() => openContact()}
      />
      <ContactFormDialog
        open={contactOpen}
        onOpenChange={setContactOpen}
        kind="customer"
        contact={editing}
        onSubmit={async (input) => {
          const c = await save.mutateAsync({ id: editing?.id, input })
          toast.success(editing ? 'Customer updated' : 'Customer added')
          if (!editing) setPresetCustomer(c.id)
        }}
      />
    </div>
  )
}
