import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART, TooltipBox, TooltipRow } from '@/components/charts/ChartBits'
import { formatDayLabel } from '@/lib/barbershop'
import { fillDays } from '@/lib/earnings'
import { formatZAR, formatZARCompact } from '@/lib/format'
import type { EarningsDto } from '@/types/pro'

/** Services done per day (completed visits at the barber's prices), brass bars. */
export function EarningsChart({ e, height = 220 }: { e: Pick<EarningsDto, 'from' | 'to' | 'days'>; height?: number }) {
  const data = fillDays(e.from, e.to, e.days)
  if (data.every((d) => d.visits === 0))
    return (
      <div className="flex items-center justify-center rounded-lg border border-dashed border-line-strong px-4 text-center text-sm text-ink-muted" style={{ height: height / 1.6 }}>
        No completed visits in this period yet.
      </div>
    )
  const many = data.length > 10
  return (
    <div style={{ height }} role="img" aria-label={`Services done per day: ${data.filter((d) => d.visits > 0).map((d) => `${formatDayLabel(d.date)} ${formatZAR(d.servicesCents)}`).join(', ')}`}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barCategoryGap={many ? '18%' : '30%'}>
          <CartesianGrid vertical={false} stroke={CHART.grid} />
          <XAxis
            dataKey="date"
            tickFormatter={(d: string) => (many ? String(Number(d.slice(8))) : formatDayLabel(d).split(' ').slice(0, 2).join(' '))}
            tickLine={false}
            axisLine={{ stroke: CHART.grid }}
            tick={{ fill: CHART.axis, fontSize: 12 }}
            interval={many ? 'preserveStartEnd' : 0}
            minTickGap={4}
          />
          <YAxis tickFormatter={formatZARCompact} tickLine={false} axisLine={false} tick={{ fill: CHART.axis, fontSize: 12 }} width={52} />
          <Tooltip
            cursor={{ fill: CHART.cursor }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const p = payload[0].payload as (typeof data)[number]
              return (
                <TooltipBox title={formatDayLabel(p.date)}>
                  <TooltipRow color={CHART.brass} label="Services done" value={formatZAR(p.servicesCents)} />
                  <TooltipRow color="transparent" label="Visits" value={String(p.visits)} />
                </TooltipBox>
              )
            }}
          />
          <Bar dataKey="servicesCents" name="Services done" fill={CHART.brass} radius={[5, 5, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
