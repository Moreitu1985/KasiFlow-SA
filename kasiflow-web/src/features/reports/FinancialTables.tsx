import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table'
import { Money } from '@/components/shared/Money'
import type { CategoryBreakdownRow, MonthlyRow } from '@/types/api'

export function CategoryTable({ rows }: { rows: CategoryBreakdownRow[] }) {
  if (!rows.length) return <p className="text-sm text-ink-muted">No transactions in this period.</p>
  const sorted = [...rows].sort((a, b) => (a.type === b.type ? b.totalCents - a.totalCents : a.type === 'income' ? -1 : 1))
  return (
    <Table>
      <THead>
        <TR>
          <TH>Type</TH>
          <TH>Category</TH>
          <TH className="text-right">Entries</TH>
          <TH className="text-right">Share</TH>
          <TH className="text-right">Total</TH>
        </TR>
      </THead>
      <TBody>
        {sorted.map((r) => (
          <TR key={r.type + r.category}>
            <TD className="text-ink-soft">{r.type === 'income' ? 'Income' : 'Expense'}</TD>
            <TD className="font-medium">{r.category}</TD>
            <TD className="text-right tabular">{r.count}</TD>
            <TD className="text-right tabular">{Math.round(r.sharePercent)}%</TD>
            <TD className="text-right font-semibold">
              <Money cents={r.totalCents} />
            </TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}

export function MonthlyTable({ rows }: { rows: MonthlyRow[] }) {
  if (!rows.length) return <p className="text-sm text-ink-muted">No months in this period.</p>
  return (
    <Table>
      <THead>
        <TR>
          <TH>Month</TH>
          <TH className="text-right">Income</TH>
          <TH className="text-right">Expenses</TH>
          <TH className="text-right">Net recorded result</TH>
        </TR>
      </THead>
      <TBody>
        {rows.map((m) => (
          <TR key={m.month}>
            <TD className="font-medium">{m.label}</TD>
            <TD className="text-right"><Money cents={m.incomeCents} /></TD>
            <TD className="text-right"><Money cents={m.expensesCents} /></TD>
            <TD className="text-right font-semibold"><Money cents={m.netCents} tone="auto" /></TD>
          </TR>
        ))}
      </TBody>
    </Table>
  )
}
