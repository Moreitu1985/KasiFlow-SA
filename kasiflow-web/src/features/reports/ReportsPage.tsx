import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Download, FileText, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { RoleHeader } from '@/features/access/RoleHeader'
import { DateRangeBar } from '@/components/shared/DateRangeBar'
import { KpiCard } from '@/components/shared/KpiCard'
import { Money } from '@/components/shared/Money'
import { CardsSkeleton, ChartSkeleton, ErrorState, ListSkeleton } from '@/components/shared/States'
import { IncomeExpenseChart } from '@/components/charts/IncomeExpenseChart'
import { CategoryChart } from '@/components/charts/CategoryChart'
import { ForecastChart } from '@/components/charts/ForecastChart'
import { RANGE_PRESETS } from '@/lib/periods'
import { DebtsTab } from '@/features/customers/CustomersPage'
import { BillsTab } from '@/features/suppliers/SuppliersPage'
import { ForecastTable } from '@/features/cashflow/ForecastTable'
import { HorizonSelect } from '@/features/cashflow/HorizonSelect'
import type { ExportKind } from '@/types/api'
import { EXPORT_LABELS, useCashFlowReport, useCsvExport, useFinancialSummary } from './api'
import { CategoryTable, MonthlyTable } from './FinancialTables'

const EXPORT_HELP: Record<ExportKind, string> = {
  transactions: 'Every transaction in the date range (Actual).',
  'category-breakdown': 'Income and expense totals per category (Actual).',
  monthly: 'Income, expenses and net per month (Actual).',
  receivables: 'Customer debts and what is still owed.',
  payables: 'Supplier bills and what is still to pay.',
  'cash-flow': 'Day-by-day cash forecast (Forecast).',
  readiness: 'Registration and funding readiness checklists.',
  'business-summary': 'The one-page business summary.',
}

function FinancialTab({ from, to }: { from: string; to: string }) {
  const q = useFinancialSummary(from, to)
  if (q.isLoading) return <CardsSkeleton />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const s = q.data
  if (!s) return null
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Badge variant="success">Actual</Badge>
        <span className="text-sm text-ink-muted">Recorded transactions, {s.period.label}</span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard label="Income" value={<Money cents={s.incomeCents} />} definition="Posted income in the period." />
        <KpiCard label="Expenses" value={<Money cents={s.expensesCents} />} definition="Posted expenses in the period." />
        <KpiCard label="Net recorded result" value={<Money cents={s.netResultCents} tone="auto" />} note="Not audited profit" definition="Income minus expenses you recorded. Not an audited profit figure." />
        <KpiCard label="Transactions" value={s.transactionCount} definition="Number of posted transactions in the period." />
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>By category</CardTitle>
          </CardHeader>
          <CardContent>{s.categoryBreakdown.length ? <CategoryChart rows={s.categoryBreakdown} /> : <p className="text-sm text-ink-muted">No transactions in this period.</p>}</CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Monthly performance</CardTitle>
          </CardHeader>
          <CardContent>{s.monthly.length ? <IncomeExpenseChart data={s.monthly} /> : <p className="text-sm text-ink-muted">No months in this period.</p>}</CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Category breakdown</CardTitle>
        </CardHeader>
        <CategoryTable rows={s.categoryBreakdown} />
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Month by month</CardTitle>
        </CardHeader>
        <MonthlyTable rows={s.monthly} />
      </Card>
    </div>
  )
}

function ForecastTab() {
  const [days, setDays] = useState<number>()
  const q = useCashFlowReport(days)
  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <Badge variant="warning">Forecast</Badge>
          <span className="text-sm text-ink-muted">Projection from today, not recorded results</span>
        </div>
        <HorizonSelect value={days ?? q.data?.horizonDays} onChange={setDays} />
      </div>
      {q.isLoading ? (
        <ChartSkeleton />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.data ? (
        <>
          <Card>
            <CardContent className="pt-5">
              <ForecastChart
                data={q.data.days.map((d) => ({ date: d.date, expectedCents: d.expectedClosingCents, conservativeCents: d.conservativeClosingCents, optimisticCents: d.optimisticClosingCents }))}
                bufferCents={q.data.cashBufferCents}
                scenarios={q.data.scenarios}
              />
            </CardContent>
          </Card>
          <ForecastTable forecast={q.data} onlyActiveDays />
        </>
      ) : (
        <ListSkeleton />
      )}
    </div>
  )
}

export function ReportsPage() {
  const navigate = useNavigate()
  const [range, setRange] = useState(RANGE_PRESETS[0].range())
  const [tab, setTab] = useState('financial')
  const csv = useCsvExport()
  const kinds = Object.keys(EXPORT_LABELS) as ExportKind[]

  return (
    <div>
      <RoleHeader
        title="Reports"
        description="Your recorded results, debts, bills and forecast — ready to review, print or export."
        actions={
          <Button asChild variant="outline">
            <Link to={`/reports/business-summary?from=${range.from}&to=${range.to}`}>
              <Printer /> Business summary
            </Link>
          </Button>
        }
      />
      <DateRangeBar from={range.from} to={range.to} onChange={setRange} className="mb-5" />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="financial">Financial summary</TabsTrigger>
          <TabsTrigger value="receivables">Customer debts</TabsTrigger>
          <TabsTrigger value="payables">Supplier bills</TabsTrigger>
          <TabsTrigger value="forecast">Cash-flow forecast</TabsTrigger>
          <TabsTrigger value="export">Export CSV</TabsTrigger>
        </TabsList>
        <TabsContent value="financial">{range.from <= range.to && <FinancialTab from={range.from} to={range.to} />}</TabsContent>
        <TabsContent value="receivables">
          <p className="mb-4 text-sm text-ink-muted">Current position — not limited to the date range.</p>
          <DebtsTab onAddDebt={() => navigate('/customers')} />
        </TabsContent>
        <TabsContent value="payables">
          <p className="mb-4 text-sm text-ink-muted">Current position — not limited to the date range.</p>
          <BillsTab onAddBill={() => navigate('/suppliers')} />
        </TabsContent>
        <TabsContent value="forecast">
          <ForecastTab />
        </TabsContent>
        <TabsContent value="export">
          <Card>
            <CardHeader>
              <CardTitle>Download spreadsheets</CardTitle>
              <CardDescription>
                CSV files open in Excel, Google Sheets or LibreOffice. Amounts are in rand with two decimals, and rows are labelled Actual or Forecast. Date-based exports use {range.from} to {range.to}.
              </CardDescription>
            </CardHeader>
            <ul className="divide-y divide-line border-t border-line">
              {kinds.map((k) => (
                <li key={k} className="flex items-center gap-3 px-5 py-3">
                  <FileText className="size-4 shrink-0 text-ink-muted" aria-hidden />
                  <div className="flex-1">
                    <p className="text-sm font-semibold">{EXPORT_LABELS[k]}</p>
                    <p className="text-[13px] text-ink-muted">{EXPORT_HELP[k]}</p>
                  </div>
                  <Button size="sm" variant="outline" loading={csv.pending === k} disabled={csv.pending !== null && csv.pending !== k} onClick={() => csv.run(k, range)}>
                    <Download /> CSV
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
