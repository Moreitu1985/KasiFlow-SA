import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { api, errorMessage } from '@/lib/apiClient'
import { useBizKey, useBizReady } from '@/hooks/useBizQuery'
import type { BusinessSummaryDto, ExportKind, FinancialSummaryDto, ForecastDto } from '@/types/api'

export function useFinancialSummary(from: string, to: string) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('reports', 'financial', from, to),
    queryFn: () => api.get<FinancialSummaryDto>('/api/reports/financial-summary', { from, to }),
    enabled: useBizReady() && !!from && !!to && from <= to,
  })
}

export function useCashFlowReport(days?: number) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('reports', 'cash-flow', days ?? 'default'),
    queryFn: () => api.get<ForecastDto>('/api/reports/cash-flow', { days }),
    enabled: useBizReady(),
  })
}

export function useBusinessSummary(from: string, to: string) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('reports', 'business-summary', from, to),
    queryFn: () => api.get<BusinessSummaryDto>('/api/reports/business-summary', { from, to }),
    enabled: useBizReady() && !!from && !!to && from <= to,
  })
}

export const EXPORT_LABELS: Record<ExportKind, string> = {
  transactions: 'Transactions',
  'category-breakdown': 'Category breakdown',
  monthly: 'Monthly performance',
  receivables: 'Customer debts',
  payables: 'Supplier bills',
  'cash-flow': 'Cash-flow forecast',
  readiness: 'Readiness checklist',
  'business-summary': 'Business summary',
}

/** Download `/api/reports/export/{kind}.csv` and track which export is in progress. */
export function useCsvExport() {
  const [pending, setPending] = useState<ExportKind | null>(null)
  const run = async (kind: ExportKind, range?: { from?: string; to?: string }) => {
    setPending(kind)
    try {
      await api.download(`/api/reports/export/${kind}.csv`, { from: range?.from, to: range?.to }, `kasiflow-${kind}.csv`)
      toast.success(`${EXPORT_LABELS[kind]} exported`)
    } catch (err) {
      toast.error('Export failed', { description: errorMessage(err) })
    } finally {
      setPending(null)
    }
  }
  return { run, pending }
}
