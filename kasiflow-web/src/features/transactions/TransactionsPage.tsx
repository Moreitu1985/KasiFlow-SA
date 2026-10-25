import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, ReceiptText, Search, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input, NativeSelect } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { RoleHeader } from '@/features/access/RoleHeader'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { Pagination } from '@/components/shared/Pagination'
import { Money } from '@/components/shared/Money'
import { OriginBadge, TxnStatusBadge } from '@/components/shared/Badges'
import { formatDate } from '@/lib/format'
import { PAYMENT_METHODS, PAYMENT_STATUS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { TransactionOrigin, TransactionQuery, TransactionStatus, TransactionType } from '@/types/api'
import { ORIGIN_LABELS } from '@/lib/automation'
import { useAccess } from '@/features/access/useAccess'
import { useBranches } from '@/features/branches/api'
import { useCategories, useTransactions } from './api'
import { TransactionListItem, TxnIcon } from './TransactionRow'
import { useRecord } from './RecordProvider'

const PAGE_SIZE = 20

export function TransactionsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { openRecord } = useRecord()
  const categories = useCategories()
  const { can } = useAccess()
  const branches = useBranches()
  const branchList = branches.data ?? []

  const q: TransactionQuery = {
    type: (params.get('type') as TransactionType | null) ?? '',
    category: params.get('category') ?? '',
    status: (params.get('status') as TransactionStatus | 'all' | null) ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    search: params.get('search') ?? '',
    branchId: params.get('branchId') ?? '',
    origin: (params.get('origin') as TransactionOrigin | null) ?? '',
    page: Number(params.get('page') ?? '1') || 1,
    pageSize: PAGE_SIZE,
  }
  const [searchText, setSearchText] = useState(q.search ?? '')
  const list = useTransactions(q)

  const update = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('page' in patch)) next.delete('page')
    setParams(next, { replace: true })
  }

  // Debounce the search box into the URL.
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('search') ?? '') !== searchText.trim()) update({ search: searchText.trim() })
    }, 350)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText])

  const catList = q.type === 'income' ? categories.data?.income : q.type === 'expense' ? categories.data?.expense : [...(categories.data?.income ?? []), ...(categories.data?.expense ?? [])]
  const hasFilters = !!(q.type || q.category || q.status || q.from || q.to || q.search || q.branchId || q.origin)
  const [showFilters, setShowFilters] = useState(!!(q.type || q.category || q.status || q.from || q.to || q.branchId || q.origin))
  const more = cn(!showFilters && 'max-md:hidden')

  return (
    <div>
      <RoleHeader
        title="Transactions"
        description="Every rand in and out of the business. Voided entries stay on record for history."
        actions={
          <>
            {can('manageFinancials') && (
              <Button variant="outline" onClick={() => openRecord('expense')}>
                <Plus /> Expense
              </Button>
            )}
            {can('manageFinancials', 'recordSales') && (
              <Button onClick={() => openRecord('income')}>
                <Plus /> {can('manageFinancials') ? 'Income' : 'Record sale'}
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 rounded-xl border border-line bg-surface p-4 shadow-card sm:grid-cols-2 lg:grid-cols-4">
        <div className="sm:col-span-2 lg:col-span-2">
          <Label htmlFor="f-search">Search</Label>
          <div className="mt-1.5 flex gap-2">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-muted" aria-hidden />
              <Input id="f-search" className="pl-9" placeholder="Description, reference, name" value={searchText} onChange={(e) => setSearchText(e.target.value)} />
            </div>
            <Button type="button" variant="outline" className="md:hidden" aria-expanded={showFilters} aria-controls="txn-filters" onClick={() => setShowFilters((v) => !v)}>
              <SlidersHorizontal /> Filters
            </Button>
          </div>
        </div>
        <div id="txn-filters" className={more}>
          <Label htmlFor="f-type">Type</Label>
          <NativeSelect id="f-type" className="mt-1.5" value={q.type} onChange={(e) => update({ type: e.target.value, category: '' })}>
            <option value="">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
          </NativeSelect>
        </div>
        <div className={more}>
          <Label htmlFor="f-cat">Category</Label>
          <NativeSelect id="f-cat" className="mt-1.5" value={q.category} onChange={(e) => update({ category: e.target.value })}>
            <option value="">All categories</option>
            {catList?.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </div>
        <div className={more}>
          <Label htmlFor="f-status">Status</Label>
          <NativeSelect id="f-status" className="mt-1.5" value={q.status} onChange={(e) => update({ status: e.target.value })}>
            <option value="">Posted and scheduled</option>
            <option value="posted">Posted only</option>
            <option value="scheduled">Scheduled only</option>
            <option value="voided">Voided only</option>
            <option value="all">Everything incl. voided</option>
          </NativeSelect>
        </div>
        <div className={cn('grid grid-cols-2 gap-2 sm:col-span-2', more)}>
          <div>
            <Label htmlFor="f-from">From</Label>
            <Input id="f-from" type="date" className="mt-1.5" value={q.from} onChange={(e) => update({ from: e.target.value })} />
          </div>
          <div>
            <Label htmlFor="f-to">To</Label>
            <Input id="f-to" type="date" className="mt-1.5" value={q.to} onChange={(e) => update({ to: e.target.value })} />
          </div>
        </div>
        <div className={more}>
          <Label htmlFor="f-origin">Source</Label>
          <NativeSelect id="f-origin" className="mt-1.5" value={q.origin} onChange={(e) => update({ origin: e.target.value })}>
            <option value="">All sources</option>
            {(Object.keys(ORIGIN_LABELS) as TransactionOrigin[]).map((k) => (
              <option key={k} value={k}>
                {ORIGIN_LABELS[k]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {branchList.length > 1 && (
          <div className={more}>
            <Label htmlFor="f-branch">Branch</Label>
            <NativeSelect id="f-branch" className="mt-1.5" value={q.branchId} onChange={(e) => update({ branchId: e.target.value })}>
              <option value="">All branches</option>
              {branchList.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </div>
        )}
        {hasFilters && (
          <div className="sm:col-span-2 lg:col-span-6">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setSearchText('')
                setParams(new URLSearchParams(), { replace: true })
              }}
            >
              <X /> Clear filters
            </Button>
          </div>
        )}
      </div>

      {list.isLoading ? (
        <ListSkeleton rows={8} />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => list.refetch()} />
      ) : !list.data || list.data.items.length === 0 ? (
        hasFilters ? (
          <EmptyState icon={Search} title="No transactions match these filters" description="Try a wider date range or clear the filters." />
        ) : (
          <EmptyState
            icon={ReceiptText}
            title="No transactions yet"
            description="Record today's sales and expenses. A few entries a day is enough to see where your money goes."
            action={
              <>
                {can('manageFinancials', 'recordSales') && <Button onClick={() => openRecord('income')}>Record a sale</Button>}
                {can('manageFinancials') && (
                  <Button variant="outline" onClick={() => openRecord('expense')}>
                    Record an expense
                  </Button>
                )}
              </>
            }
          />
        )
      ) : (
        <div className={cn(list.isFetching && 'opacity-70 transition-opacity')}>
          {/* Mobile: cards */}
          <div className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface md:hidden">
            {list.data.items.map((t) => (
              <TransactionListItem key={t.id} t={t} />
            ))}
          </div>
          {/* Desktop: table */}
          <div className="hidden overflow-hidden rounded-lg border border-line bg-surface md:block">
            <Table>
              <THead>
                <TR>
                  <TH>Date</TH>
                  <TH>Description</TH>
                  <TH>Category</TH>
                  <TH>Method</TH>
                  <TH>Status</TH>
                  <TH className="text-right">Amount</TH>
                </TR>
              </THead>
              <TBody>
                {list.data.items.map((t) => (
                  <TR
                    key={t.id}
                    className="cursor-pointer hover:bg-paper"
                    onClick={() => navigate(`/transactions/${t.id}`)}
                  >
                    <TD className="whitespace-nowrap text-ink-soft">{formatDate(t.transactionDate)}</TD>
                    <TD>
                      <div className="flex items-center gap-3">
                        <TxnIcon type={t.type} />
                        <div className="min-w-0">
                          <Link
                            to={`/transactions/${t.id}`}
                            onClick={(e) => e.stopPropagation()}
                            className={cn('font-medium hover:underline', t.status === 'voided' && 'text-ink-muted line-through')}
                          >
                            {t.description}
                          </Link>
                          {(t.counterpartyName || t.reference || t.branchName) && (
                            <p className="truncate text-[13px] text-ink-muted">{[t.counterpartyName, t.reference, t.branchName].filter(Boolean).join(' · ')}</p>
                          )}
                        </div>
                      </div>
                    </TD>
                    <TD className="text-ink-soft">{t.category}</TD>
                    <TD className="text-ink-soft">{PAYMENT_METHODS[t.paymentMethod]}</TD>
                    <TD>
                      <div className="flex flex-wrap gap-1">
                        <TxnStatusBadge status={t.status} />
                        <OriginBadge origin={t.origin} />
                        {t.paymentStatus !== 'recorded_manually' && t.status !== 'voided' && (
                          <Badge variant={t.paymentStatus === 'awaiting_confirmation' ? 'warning' : 'neutral'}>{PAYMENT_STATUS[t.paymentStatus]}</Badge>
                        )}
                      </div>
                    </TD>
                    <TD className="text-right">
                      <Money
                        cents={t.type === 'income' ? t.amountCents : -t.amountCents}
                        signed
                        tone={t.type === 'income' ? 'income' : 'expense'}
                        className={cn('font-semibold', t.status === 'voided' && 'line-through opacity-60')}
                      />
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <Pagination page={list.data.page} totalPages={list.data.totalPages} totalCount={list.data.totalCount} onPage={(p) => update({ page: String(p) })} />
        </div>
      )}
    </div>
  )
}
