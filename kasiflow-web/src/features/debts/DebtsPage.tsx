import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarClock, HandCoins, Plus, Users } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Callout } from '@/components/shared/Callout'
import { KpiCard } from '@/components/shared/KpiCard'
import { Money } from '@/components/shared/Money'
import { RoleHeader } from '@/features/access/RoleHeader'
import { CardsSkeleton, ErrorState, ListSkeleton } from '@/components/shared/States'
import { DebtStatusBadge } from '@/components/shared/StatusBadges'
import { formatDate, formatDateTime } from '@/lib/format'
import { useAccess } from '@/features/access/useAccess'
import { AddDebtDialog } from '@/features/customers/AddDebtDialog'
import { DebtsTab } from '@/features/customers/CustomersPage'
import { useOverdueReport } from './api'

function OverdueReport() {
  const q = useOverdueReport()
  if (q.isLoading)
    return (
      <div className="space-y-4">
        <CardsSkeleton />
        <ListSkeleton rows={3} />
      </div>
    )
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const r = q.data
  if (!r) return null
  return (
    <div className="space-y-6">
      <div className="grid min-w-0 grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Overdue (principal)" value={<Money cents={r.overduePrincipalCents} />} definition="What customers still owe on debts past their due date, excluding any charges." tone={r.overduePrincipalCents > 0 ? 'critical' : 'default'} />
        <KpiCard label="Applied late charges" value={<Money cents={r.overdueChargesCents} />} definition="Late charges actually added to overdue debts. Proposed charges are not included." />
        <KpiCard label="Overdue debts" value={r.overdueCount} definition="Number of open debts past their due date." />
        <KpiCard label="Expected in 30 days" value={<Money cents={r.expectedNext30DaysCents} />} definition="Debts due in the next 30 days. Expected — not received." note="Expected — not received" />
      </div>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle>Overdue — follow up</CardTitle>
          <CardDescription>Most overdue first. Principal and charges are shown separately.</CardDescription>
        </CardHeader>
        {r.items.length === 0 ? (
          <CardContent>
            <p className="text-sm text-ink-muted">No overdue debts. Well done.</p>
          </CardContent>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {r.items.map((o) => (
              <li key={o.debt.id}>
                <Link to={`/debts/${o.debt.id}`} className="flex flex-col gap-2 px-4 py-3 hover:bg-paper sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-semibold">{o.debt.customerName}</p>
                      <DebtStatusBadge status={o.debt.debtStatus ?? 'overdue'} />
                      <Badge variant="critical">{o.debt.daysOverdue} days overdue</Badge>
                      {o.needsReview && <Badge variant="warning">Needs review</Badge>}
                    </div>
                    <p className="truncate text-[13px] text-ink-soft">{o.debt.description}</p>
                    <p className="text-[12px] text-ink-muted">
                      {o.reminderCount} {o.reminderCount === 1 ? 'reminder' : 'reminders'}
                      {o.failedAttempts > 0 && ` · ${o.failedAttempts} failed attempts`}
                      {o.lastReminderAt && ` · last ${formatDateTime(o.lastReminderAt)}`}
                    </p>
                    {o.reviewReason && <p className="text-[12px] font-medium text-amber-800">{o.reviewReason}</p>}
                  </div>
                  <div className="shrink-0 text-right text-sm">
                    <p>
                      <span className="text-[12px] text-ink-muted">Principal </span>
                      <Money cents={o.debt.principalOutstandingCents ?? o.debt.remainingCents} className="font-semibold" />
                    </p>
                    {(o.debt.chargesOutstandingCents ?? 0) > 0 && (
                      <p>
                        <span className="text-[12px] text-ink-muted">Charges </span>
                        <Money cents={o.debt.chargesOutstandingCents} />
                      </p>
                    )}
                    {(o.debt.proposedChargesCents ?? 0) > 0 && (
                      <p className="text-[12px] text-ink-muted">
                        <Money cents={o.debt.proposedChargesCents} /> proposed, not added
                      </p>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="min-w-0 overflow-hidden">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CalendarClock className="size-5 text-forest-800" aria-hidden /> Expected collections (next 30 days)
          </CardTitle>
          <CardDescription>{r.note}</CardDescription>
        </CardHeader>
        {r.expectedCollections.length === 0 ? (
          <CardContent>
            <p className="text-sm text-ink-muted">No debts due in the next 30 days.</p>
          </CardContent>
        ) : (
          <ul className="divide-y divide-line border-t border-line">
            {r.expectedCollections.map((x) => (
              <li key={x.debtId}>
                <Link to={`/debts/${x.debtId}`} className="flex items-center gap-3 px-4 py-3 hover:bg-paper">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{x.customerName}</p>
                    <p className="text-[12px] text-ink-muted">Due {formatDate(x.dueDate)}</p>
                  </div>
                  <div className="text-right">
                    <Money cents={x.amountCents} className="font-semibold" />
                    <p className="mt-0.5">
                      <Badge variant="outline">{x.label}</Badge>
                    </p>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

export function DebtsPage() {
  const { can } = useAccess()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const [debtOpen, setDebtOpen] = useState(false)
  const tab = params.get('view') === 'all' && can('viewFinancials') ? 'all' : 'overdue'
  return (
    <div className="space-y-5">
      <RoleHeader
        title="Debts"
        description="Money customers owe you: what is overdue, what to follow up and what is expected. Expected money is not money received."
       
        actions={
          <>
            {can('viewFinancials') && (
              <Button asChild variant="outline">
                <Link to="/customers?tab=customers">
                  <Users /> Customers
                </Link>
              </Button>
            )}
            {can('manageFinancials') && (
              <Button onClick={() => setDebtOpen(true)}>
                <Plus /> Record debt
              </Button>
            )}
          </>
        }
      />
      {!can('viewFinancials') && (
        <Callout tone="info">You can take payments on debts. Open a debt from the overdue list, or from a completed booking.</Callout>
      )}
      <Tabs value={tab} onValueChange={(v) => setParams(v === 'all' ? { view: 'all' } : {}, { replace: true })}>
        <TabsList>
          <TabsTrigger value="overdue">
            <HandCoins className="size-4" aria-hidden /> Overdue & expected
          </TabsTrigger>
          {can('viewFinancials') && <TabsTrigger value="all">All debts</TabsTrigger>}
        </TabsList>
        <TabsContent value="overdue">
          <OverdueReport />
        </TabsContent>
        {can('viewFinancials') && (
          <TabsContent value="all">
            <DebtsTab onAddDebt={() => setDebtOpen(true)} />
          </TabsContent>
        )}
      </Tabs>
      <AddDebtDialog open={debtOpen} onOpenChange={setDebtOpen} onAddCustomer={() => navigate('/customers?tab=customers')} />
    </div>
  )
}
