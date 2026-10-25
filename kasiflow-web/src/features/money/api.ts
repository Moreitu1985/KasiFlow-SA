import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { LIVE_REFETCH_MS, useBizKey, useBizReady } from '@/hooks/useBizQuery'
import type { MoneyPeriod, MoneySummaryDto } from '@/types/barbershop'

export function useMoneySummary(period: MoneyPeriod, enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('money', period),
    queryFn: () => api.get<MoneySummaryDto>('/api/money/summary', { period }),
    enabled: useBizReady() && enabled,
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_REFETCH_MS * 4,
  })
}
