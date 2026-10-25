import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Money } from '@/components/shared/Money'
import { formatDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { evidenceLink } from '@/features/growth/RecommendationCard'
import type { ForecastDay, ForecastDto, ForecastEventKind } from '@/types/api'

const KIND_LABEL: Record<ForecastEventKind, string> = {
  scheduled_income: 'Planned income',
  expected_collection: 'Expected customer payment',
  scheduled_expense: 'Planned expense',
  supplier_bill: 'Supplier bill',
}

function Flags({ d }: { d: ForecastDay }) {
  if (d.belowZero) return <Badge variant="critical">Below R0</Badge>
  if (d.belowBuffer) return <Badge variant="warning">Below buffer</Badge>
  return <span className="text-ink-muted">—</span>
}

export function ForecastTable({ forecast, onlyActiveDays = false }: { forecast: ForecastDto; onlyActiveDays?: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const days = onlyActiveDays ? forecast.days.filter((d, i) => i === 0 || d.events.length > 0 || d.belowBuffer || d.belowZero) : forecast.days
  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface">
      <table className="w-full min-w-[860px] border-collapse text-sm">
        <caption className="sr-only">Daily cash flow forecast</caption>
        <thead className="border-b border-line bg-paper/70 text-left text-xs text-ink-muted">
          <tr>
            <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Opening</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Scheduled in</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">
              Expected in
              <span className="block font-normal">expected, not confirmed</span>
            </th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Out</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Expected closing</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">Conservative closing</th>
            <th scope="col" className="px-3 py-2.5 font-semibold">Flags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {days.map((d) => {
            const isOpen = !!open[d.date]
            return (
              <Fragment key={d.date}>
                <tr className={cn(d.belowZero && 'bg-red-50/60', !d.belowZero && d.belowBuffer && 'bg-amber-50/50')}>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {d.events.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setOpen((o) => ({ ...o, [d.date]: !isOpen }))}
                        aria-expanded={isOpen}
                        className="inline-flex cursor-pointer items-center gap-1 font-medium text-forest-800 hover:underline"
                      >
                        <ChevronRight className={cn('size-3.5 transition-transform', isOpen && 'rotate-90')} aria-hidden />
                        {formatDate(d.date)}
                        <span className="text-xs font-normal text-ink-muted">({d.events.length})</span>
                      </button>
                    ) : (
                      <span className="pl-4.5">{formatDate(d.date)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right"><Money cents={d.openingBalanceCents} tone="auto" /></td>
                  <td className="px-3 py-2 text-right">{d.scheduledInflowsCents ? <Money cents={d.scheduledInflowsCents} /> : <span className="text-ink-muted">—</span>}</td>
                  <td className="px-3 py-2 text-right italic">{d.expectedInflowsCents ? <Money cents={d.expectedInflowsCents} /> : <span className="text-ink-muted not-italic">—</span>}</td>
                  <td className="px-3 py-2 text-right">{d.outflowsCents ? <Money cents={-d.outflowsCents} /> : <span className="text-ink-muted">—</span>}</td>
                  <td className="px-3 py-2 text-right font-semibold"><Money cents={d.expectedClosingCents} tone="auto" /></td>
                  <td className="px-3 py-2 text-right"><Money cents={d.conservativeClosingCents} tone="auto" /></td>
                  <td className="px-3 py-2"><Flags d={d} /></td>
                </tr>
                {isOpen && (
                  <tr className="bg-paper/60">
                    <td colSpan={8} className="px-3 py-2">
                      <ul className="space-y-1 pl-5">
                        {d.events.map((ev, i) => {
                          const href = evidenceLink(ev)
                          return (
                            <li key={i} className="flex flex-wrap items-center gap-x-2 text-[13px]">
                              <span className="text-ink-muted">{KIND_LABEL[ev.kind]}:</span>
                              {href ? (
                                <Link to={href} className="font-medium text-forest-800 hover:underline">
                                  {ev.description}
                                </Link>
                              ) : (
                                <span className="font-medium">{ev.description}</span>
                              )}
                              {ev.counterparty && <span className="text-ink-muted">· {ev.counterparty}</span>}
                              <Money cents={ev.kind === 'scheduled_expense' || ev.kind === 'supplier_bill' ? -ev.amountCents : ev.amountCents} className="font-semibold" />
                              {ev.isExpected && <Badge variant="neutral">Expected, not confirmed</Badge>}
                              {ev.isOverdueCarryForward && <Badge variant="warning">Overdue, carried to today</Badge>}
                            </li>
                          )
                        })}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function ExcludedAndAssumptions({ forecast }: { forecast: ForecastDto }) {
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="font-sans text-base font-semibold">Left out of the forecast</h2>
        <p className="text-sm text-ink-muted">Items KasiFlow did not count, and why.</p>
        {forecast.excluded.length === 0 ? (
          <p className="mt-3 text-sm text-ink-soft">Nothing was excluded.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {forecast.excluded.map((x) => {
              const href = evidenceLink(x)
              return (
                <li key={x.sourceType + x.sourceId} className="flex items-start justify-between gap-3 py-2.5">
                  <div>
                    {href ? (
                      <Link to={href} className="text-sm font-medium text-forest-800 hover:underline">
                        {x.description}
                      </Link>
                    ) : (
                      <p className="text-sm font-medium">{x.description}</p>
                    )}
                    <p className="text-[13px] text-ink-muted">{x.reason}</p>
                  </div>
                  <Money cents={x.amountCents} className="text-sm font-semibold" />
                </li>
              )
            })}
          </ul>
        )}
      </section>
      <section className="rounded-lg border border-line bg-surface p-5">
        <h2 className="font-sans text-base font-semibold">Assumptions</h2>
        <p className="text-sm text-ink-muted">How the numbers are calculated.</p>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-soft">
          {forecast.assumptions.map((a, i) => (
            <li key={i}>{a}</li>
          ))}
        </ul>
      </section>
    </div>
  )
}
