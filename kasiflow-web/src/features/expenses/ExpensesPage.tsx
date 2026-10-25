import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Car, Plus, Receipt } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { NativeSelect } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Callout } from '@/components/shared/Callout'
import { DateRangeBar } from '@/components/shared/DateRangeBar'
import { Money } from '@/components/shared/Money'
import { RoleHeader } from '@/features/access/RoleHeader'
import { Pagination } from '@/components/shared/Pagination'
import { EmptyState, ErrorState, ListSkeleton } from '@/components/shared/States'
import { todayJhb } from '@/lib/format'
import { firstOfMonth } from '@/lib/periods'
import { useAccess } from '@/features/access/useAccess'
import { useCategories, useTransactions } from '@/features/transactions/api'
import { TransactionListItem } from '@/features/transactions/TransactionRow'
import { useRecord } from '@/features/transactions/RecordProvider'

/** Money out: recorded expenses with a quick "add expense" and category filter. */
export function ExpensesPage() {
  const { can } = useAccess()
  const { openRecord } = useRecord()
  const categories = useCategories()
  const [range, setRange] = useState({ from: firstOfMonth(todayJhb()), to: todayJhb() })
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const q = useTransactions({ type: 'expense', from: range.from, to: range.to, category, status: '', page, pageSize: 20 })
  const pageTotal = useMemo(() => (q.data?.items ?? []).filter((t) => t.status === 'posted').reduce((s, t) => s + t.amountCents, 0), [q.data])

  return (
    <div className="space-y-5">
      <RoleHeader
        title="Expenses"
        description="Money out of the business: stock, rent, transport, wages and more. Voided entries stay on record."
       
        actions={
          can('manageFinancials', 'recordExpenses') && (
            <Button onClick={() => openRecord('expense')}>
              <Plus /> Add expense
            </Button>
          )
        }
      />
      {!can('manageFinancials') && can('recordExpenses') && (
        <Callout tone="info">
          You can record day-to-day expenses that have already been paid. Trip costs for a house call are best added on the booking itself (open the booking, then “Add trip expense”) so the visit’s contribution is correct.{' '}
          <Link to="/house-calls" className="inline-flex items-center gap-1 font-semibold text-forest-800 hover:underline">
            <Car className="size-4" aria-hidden /> House calls
          </Link>
        </Callout>
      )}
      <DateRangeBar
        from={range.from}
        to={range.to}
        onChange={(r) => {
          setRange(r)
          setPage(1)
        }}
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="sm:w-64">
          <Label htmlFor="ex-cat">Category</Label>
          <NativeSelect
            id="ex-cat"
            className="mt-1.5"
            value={category}
            onChange={(e) => {
              setCategory(e.target.value)
              setPage(1)
            }}
          >
            <option value="">All categories</option>
            {(categories.data?.expense ?? []).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </NativeSelect>
        </div>
        {q.data && q.data.items.length > 0 && (
          <p className="text-sm text-ink-muted">
            This page: <Money cents={pageTotal} className="font-semibold text-ink" /> posted
          </p>
        )}
      </div>
      {q.isLoading ? (
        <ListSkeleton rows={5} />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.items.length ? (
        <EmptyState
          icon={Receipt}
          title="No expenses in these dates"
          action={can('manageFinancials', 'recordExpenses') ? <Button onClick={() => openRecord('expense')}><Plus /> Add expense</Button> : undefined}
        />
      ) : (
        <>
          <Card className="min-w-0 overflow-hidden">
            <ul className="divide-y divide-line">
              {q.data.items.map((t) => (
                <li key={t.id}>
                  <TransactionListItem t={t} />
                </li>
              ))}
            </ul>
          </Card>
          <Pagination page={q.data.page} totalPages={q.data.totalPages} totalCount={q.data.totalCount} onPage={setPage} />
        </>
      )}
    </div>
  )
}
