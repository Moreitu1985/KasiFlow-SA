import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatZAR, formatZARCompact } from '@/lib/format'
import { CHART, LegendSwatch, TooltipBox, TooltipRow } from './ChartBits'

export interface MonthPoint {
  label: string
  incomeCents: number
  expensesCents: number
}

function shortLabel(label: string) {
  // "May 2026" -> "May"
  return label.split(' ')[0] ?? label
}

export function IncomeExpenseChart({ data, height = 260 }: { data: MonthPoint[]; height?: number }) {
  if (data.every((d) => d.incomeCents === 0 && d.expensesCents === 0))
    return (
      <div className="flex items-center justify-center rounded-md border border-dashed border-line-strong px-4 text-center text-sm text-ink-muted" style={{ height: height / 1.6 }}>
        No income or expenses recorded in these months yet.
      </div>
    )
  return (
    <figure>
      <div className="mb-3 flex gap-4">
        <LegendSwatch color={CHART.income} label="Income" />
        <LegendSwatch color={CHART.expense} label="Expenses" />
      </div>
      <div style={{ height }} role="img" aria-label={`Income and expenses for ${data.map((d) => d.label).join(', ')}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} barGap={2} barCategoryGap="28%" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={CHART.grid} />
            <XAxis dataKey="label" tickFormatter={shortLabel} tickLine={false} axisLine={{ stroke: CHART.grid }} tick={{ fill: CHART.axis, fontSize: 12 }} />
            <YAxis tickFormatter={formatZARCompact} tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 12 }} width={56} />
            <Tooltip
              cursor={{ fill: CHART.cursor }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const p = payload[0].payload as MonthPoint
                return (
                  <TooltipBox title={p.label}>
                    <TooltipRow color={CHART.income} label="Income" value={formatZAR(p.incomeCents)} />
                    <TooltipRow color={CHART.expense} label="Expenses" value={formatZAR(p.expensesCents)} />
                    <TooltipRow color="transparent" label="Net" value={formatZAR(p.incomeCents - p.expensesCents)} />
                  </TooltipBox>
                )
              }}
            />
            <Bar dataKey="incomeCents" name="Income" fill={CHART.income} radius={[4, 4, 0, 0]} maxBarSize={28} />
            <Bar dataKey="expensesCents" name="Expenses" fill={CHART.expense} radius={[4, 4, 0, 0]} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
