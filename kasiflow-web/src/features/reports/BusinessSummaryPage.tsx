import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Download, Printer } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { DateRangeBar } from '@/components/shared/DateRangeBar'
import { ErrorState } from '@/components/shared/States'
import { Wordmark } from '@/components/shared/Logo'
import { formatDate, formatDateTime, formatPercent, formatZAR } from '@/lib/format'
import { PROVINCES, REGISTRATION_STATUS } from '@/lib/labels'
import { RANGE_PRESETS } from '@/lib/periods'
import { useBusinessSummary, useCsvExport } from './api'
import { CategoryTable, MonthlyTable } from './FinancialTables'

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="print-avoid-break rounded-md border border-line p-3">
      <p className="text-[12px] text-ink-muted">{label}</p>
      <p className="font-display text-lg font-semibold tabular">{value}</p>
      {note && <p className="text-[12px] text-ink-muted">{note}</p>}
    </div>
  )
}

function SectionTitle({ kind, children }: { kind: 'Actual' | 'Forecast' | 'Readiness'; children: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center gap-2 border-b border-line pb-1.5">
      <h2 className="font-sans text-base font-bold">{children}</h2>
      <span
        className={`rounded border px-1.5 py-0.5 text-[11px] font-bold ${kind === 'Forecast' ? 'border-amber-400 text-amber-800' : kind === 'Actual' ? 'border-emerald-400 text-emerald-800' : 'border-line-strong text-ink-soft'}`}
      >
        {kind}
      </span>
    </div>
  )
}

export function BusinessSummaryPage() {
  const [params, setParams] = useSearchParams()
  const def = RANGE_PRESETS[2].range()
  const from = params.get('from') ?? def.from
  const to = params.get('to') ?? def.to
  const q = useBusinessSummary(from, to)
  const csv = useCsvExport()
  const s = q.data

  return (
    <div className="min-h-dvh bg-paper print:bg-white">
      <div className="no-print border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
          <Link to="/reports" className="inline-flex items-center gap-1.5 text-sm font-medium text-forest-800 hover:underline">
            <ArrowLeft className="size-4" aria-hidden /> Back to reports
          </Link>
          <div className="flex gap-2 sm:ml-auto">
            <Button variant="outline" loading={csv.pending === 'business-summary'} onClick={() => csv.run('business-summary', { from, to })}>
              <Download /> Export CSV
            </Button>
            <Button onClick={() => window.print()} disabled={!s}>
              <Printer /> Print / Save as PDF
            </Button>
          </div>
        </div>
        <div className="mx-auto max-w-4xl px-4 pb-4">
          <DateRangeBar from={from} to={to} onChange={(r) => setParams(r, { replace: true })} />
        </div>
      </div>

      <main className="mx-auto max-w-4xl px-4 py-8 print:max-w-none print:p-0">
        {q.isLoading ? (
          <Skeleton className="h-[600px]" />
        ) : q.isError ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : s ? (
          <article className="rounded-lg border border-line bg-surface p-6 shadow-card sm:p-10 print:border-0 print:p-0 print:shadow-none">
            <header className="flex flex-col gap-4 border-b-2 border-primary pb-5 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-[13px] text-ink-muted">Business summary</p>
                <h1 className="text-3xl font-bold">{s.business.name}</h1>
                <p className="mt-1 text-sm text-ink-soft">
                  {s.business.businessType} · {s.business.town ? `${s.business.town}, ` : ''}
                  {PROVINCES[s.business.province] ?? s.business.province} · Registration: {REGISTRATION_STATUS[s.business.registrationStatus] ?? s.business.registrationStatus}
                </p>
              </div>
              <div className="text-sm sm:text-right">
                <Wordmark className="[&_svg]:size-6 [&_span]:text-base" />
                <p className="mt-2 text-ink-soft">
                  Period: {formatDate(s.period.from)} – {formatDate(s.period.to)}
                </p>
                <p className="text-[12px] text-ink-muted">Generated {formatDateTime(s.generatedAt)}</p>
              </div>
            </header>

            <section className="mt-6">
              <SectionTitle kind="Actual">Recorded results for the period</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Income" value={formatZAR(s.incomeCents)} />
                <Stat label="Expenses" value={formatZAR(s.expensesCents)} />
                <Stat label="Net recorded result" value={formatZAR(s.netResultCents)} note="Not audited profit" />
                <Stat label="Cash balance (recorded)" value={formatZAR(s.cashBalanceCents)} />
                <Stat label="Owed by customers" value={formatZAR(s.outstandingReceivablesCents)} />
                <Stat label="Owed to suppliers" value={formatZAR(s.outstandingPayablesCents)} />
              </div>
            </section>

            <section className="mt-6 print-avoid-break">
              <SectionTitle kind="Actual">By category</SectionTitle>
              <CategoryTable rows={s.categoryBreakdown} />
            </section>

            <section className="mt-6 print-avoid-break">
              <SectionTitle kind="Actual">Month by month</SectionTitle>
              <MonthlyTable rows={s.monthly} />
            </section>

            <section className="mt-6 print-avoid-break">
              <SectionTitle kind="Forecast">Cash outlook, next {s.forecast.horizonDays} days</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Lowest expected balance" value={formatZAR(s.forecast.lowestExpectedBalanceCents)} note={`on ${formatDate(s.forecast.lowestExpectedBalanceDate)}`} />
                <Stat label="Expected balance at end" value={formatZAR(s.forecast.closingExpectedBalanceCents)} />
              </div>
              <p className="mt-2 text-[12px] text-ink-muted">A projection based on recorded plans, bills and expected customer payments. Not a guarantee.</p>
            </section>

            <section className="mt-6 print-avoid-break">
              <SectionTitle kind="Readiness">Funding readiness</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Stat label="Readiness checklist" value={formatPercent(s.readinessPercent)} note="Not a credit score" />
                <Stat label="Amount requested" value={s.amountRequestedCents !== null ? formatZAR(s.amountRequestedCents) : 'Not stated'} />
              </div>
              {s.fundingPurpose && (
                <p className="mt-3 text-sm">
                  <span className="font-semibold">Purpose: </span>
                  {s.fundingPurpose}
                </p>
              )}
            </section>

            <footer className="mt-8 border-t border-line pt-4 text-[12px] leading-relaxed text-ink-muted">
              <p>{s.disclaimer}</p>
              <p className="mt-1">Figures are recorded by the business owner in KasiFlow SA and have not been audited or independently verified.</p>
            </footer>
          </article>
        ) : null}
      </main>
    </div>
  )
}
