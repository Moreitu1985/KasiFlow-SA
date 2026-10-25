import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady } from '@/hooks/useBizQuery'
import type { DashboardPeriod, DashboardSummaryDto } from '@/types/api'

export function useDashboardSummary(period: DashboardPeriod, from?: string, to?: string) {
  const key = useBizKey()
  const custom = period === 'custom'
  return useQuery({
    queryKey: key('dashboard', period, custom ? from : null, custom ? to : null),
    queryFn: () =>
      api.get<DashboardSummaryDto>('/api/dashboard/summary', { period, from: custom ? from : undefined, to: custom ? to : undefined }),
    enabled: useBizReady() && (!custom || (!!from && !!to && from <= to)),
    placeholderData: keepPreviousData,
  })
}
