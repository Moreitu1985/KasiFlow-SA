import { Bar, BarChart, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { formatZAR, formatZARCompact } from '@/lib/format'
import type { CategoryBreakdownRow } from '@/types/api'
import { CHART, LegendSwatch, TooltipBox, TooltipRow } from './ChartBits'

export function CategoryChart({ rows }: { rows: CategoryBreakdownRow[] }) {
  const data = [...rows].sort((a, b) => (a.type === b.type ? b.totalCents - a.totalCents : a.type === 'income' ? -1 : 1))
  const height = Math.max(160, data.length * 34 + 30)
  return (
    <figure>
      <div className="mb-3 flex gap-4">
        <LegendSwatch color={CHART.income} label="Income" />
        <LegendSwatch color={CHART.expense} label="Expenses" />
      </div>
      <div style={{ height }} role="img" aria-label="Totals by category">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barCategoryGap={6}>
            <XAxis type="number" tickFormatter={formatZARCompact} tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 12 }} />
            <YAxis type="category" dataKey="category" width={130} tickLine={false} axisLine={false} tick={{ fill: CHART.label, fontSize: 12 }} />
            <Tooltip
              cursor={{ fill: CHART.cursor }}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const r = payload[0].payload as CategoryBreakdownRow
                return (
                  <TooltipBox title={r.category}>
                    <TooltipRow color={r.type === 'income' ? CHART.income : CHART.expense} label={`${r.count} entries`} value={formatZAR(r.totalCents)} />
                    <p className="text-ink-muted">{Math.round(r.sharePercent)}% of {r.type === 'income' ? 'income' : 'expenses'}</p>
                  </TooltipBox>
                )
              }}
            />
            <Bar dataKey="totalCents" radius={[0, 4, 4, 0]} maxBarSize={22}>
              {data.map((r) => (
                <Cell key={r.type + r.category} fill={r.type === 'income' ? CHART.income : CHART.expense} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
