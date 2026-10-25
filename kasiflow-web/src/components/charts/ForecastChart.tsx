import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatDate, formatShortDate, formatZAR, formatZARCompact } from '@/lib/format'
import type { ForecastScenario } from '@/types/api'
import { CHART, LegendItem, TooltipBox, TooltipRow } from './ChartBits'

export interface ForecastPoint {
  date: string
  expectedCents: number
  conservativeCents: number
  /** Optimistic scenario. Omitted by older APIs; then the line is not drawn. */
  optimisticCents?: number
}

/** Mirrors the API's scenario texts; used where the response does not carry them (dashboard summary). */
const DEFAULT_SCENARIOS: ForecastScenario[] = [
  { key: 'expected', name: 'Expected', assumption: 'Recorded cash, scheduled items, supplier bills on their due dates, and customer debts collected on their due dates.' },
  { key: 'conservative', name: 'Conservative', assumption: 'Same as expected, but no customer debts are collected.' },
  { key: 'optimistic', name: 'Optimistic', assumption: 'Same as expected, plus overdue customer debts and pending provider payments arriving tomorrow.' },
]

/** Contiguous date ranges where the given predicate holds. */
function runs(data: ForecastPoint[], pred: (p: ForecastPoint) => boolean): [string, string][] {
  const out: [string, string][] = []
  let start: string | null = null
  let last: string | null = null
  for (const p of data) {
    if (pred(p)) {
      if (!start) start = p.date
      last = p.date
    } else if (start && last) {
      out.push([start, last])
      start = null
    }
  }
  if (start && last) out.push([start, last])
  return out
}

export function ForecastChart({
  data,
  bufferCents,
  height = 280,
  highlightShortage = true,
  scenarios,
  showScenarios = false,
}: {
  data: ForecastPoint[]
  bufferCents?: number
  height?: number
  highlightShortage?: boolean
  /** Scenario descriptions from the API (ForecastDto.scenarios). */
  scenarios?: ForecastScenario[] | null
  /** Show the three scenario descriptions under the chart. */
  showScenarios?: boolean
}) {
  const hasOptimistic = data.some((p) => typeof p.optimisticCents === 'number')
  const shortage = highlightShortage ? runs(data, (p) => p.expectedCents < 0 || p.conservativeCents < 0) : []
  const showBuffer = !!bufferCents && bufferCents > 0
  // Pad a flat series so the axis does not repeat the same tick label.
  const values = data
    .flatMap((p) => [p.expectedCents, p.conservativeCents, ...(typeof p.optimisticCents === 'number' ? [p.optimisticCents] : [])])
    .concat(showBuffer ? [bufferCents] : [], [0])
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const pad = hi === lo ? 100_000 : 0
  const flatZero = hi === 0 && lo === 0
  return (
    <figure>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1">
        <LegendItem color={CHART.expected} label="Expected balance" />
        <LegendItem color={CHART.conservative} label="Conservative (no debt collections)" dashed />
        {hasOptimistic && <LegendItem color={CHART.optimistic} label="Optimistic" dashed />}
        {showBuffer && <LegendItem color={CHART.buffer} label={`Safety buffer ${formatZAR(bufferCents)}`} dashed />}
        {shortage.length > 0 && (
          <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-soft">
            <span className="size-2.5 rounded-sm bg-red-600/20 ring-1 ring-red-600/40" aria-hidden /> Possible shortage
          </span>
        )}
      </div>
      <div
        style={{ height }}
        role="img"
        data-flat={flatZero || undefined}
        aria-label={`Cash forecast from ${formatDate(data[0]?.date)} to ${formatDate(data[data.length - 1]?.date)}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            {shortage.map(([a, b]) => (
              <ReferenceArea key={a} x1={a} x2={b} fill={CHART.shortage} fillOpacity={0.09} strokeOpacity={0} ifOverflow="extendDomain" />
            ))}
            <XAxis
              dataKey="date"
              tickFormatter={formatShortDate}
              tickLine={false}
              axisLine={{ stroke: CHART.grid }}
              tick={{ fill: CHART.axis, fontSize: 12 }}
              minTickGap={24}
            />
            <YAxis domain={[lo - (lo < 0 ? pad : 0), hi + pad]} tickFormatter={formatZARCompact} tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 12 }} width={60} />
            <ReferenceLine y={0} stroke={CHART.zero} strokeWidth={1} />
            {showBuffer && (
              <ReferenceLine
                y={bufferCents}
                stroke={CHART.buffer}
                strokeDasharray="2 4"
                strokeWidth={1.5}
                label={{ value: 'Buffer', position: 'insideTopRight', fill: CHART.axis, fontSize: 11 }}
              />
            )}
            <Tooltip
              cursor={{ stroke: CHART.zero, strokeDasharray: '3 3' }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as ForecastPoint
                return (
                  <TooltipBox title={formatDate(p.date)}>
                    <TooltipRow color={CHART.expected} label="Expected" value={formatZAR(p.expectedCents)} />
                    <TooltipRow color={CHART.conservative} label="Conservative" value={formatZAR(p.conservativeCents)} dashed />
                    {typeof p.optimisticCents === 'number' && <TooltipRow color={CHART.optimistic} label="Optimistic" value={formatZAR(p.optimisticCents)} dashed />}
                  </TooltipBox>
                )
              }}
            />
            {hasOptimistic && (
              <Line
                type="monotone"
                dataKey="optimisticCents"
                stroke={CHART.optimistic}
                strokeWidth={2}
                strokeDasharray="2 4"
                strokeLinecap="round"
                dot={false}
                activeDot={{ r: 3, strokeWidth: 2, stroke: CHART.ring }}
              />
            )}
            <Line type="monotone" dataKey="expectedCents" stroke={CHART.expected} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.ring }} />
            <Line
              type="monotone"
              dataKey="conservativeCents"
              stroke={CHART.conservative}
              strokeWidth={2}
              strokeDasharray="5 4"
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: CHART.ring }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      {showScenarios && (
        <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-3">
          {(scenarios && scenarios.length ? scenarios : DEFAULT_SCENARIOS).map((sc) => (
            <div key={sc.key} className="rounded-md bg-paper px-3 py-2">
              <dt className="font-semibold text-ink">{sc.name}</dt>
              <dd className="text-ink-muted">{sc.assumption}</dd>
            </div>
          ))}
        </dl>
      )}
      {flatZero && <figcaption className="mt-2 text-[13px] text-ink-muted">Your forecast is flat at R0.00 because nothing is recorded yet. Set an opening balance and add planned income, bills or debts.</figcaption>}
    </figure>
  )
}
