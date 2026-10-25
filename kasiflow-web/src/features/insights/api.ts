import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady } from '@/hooks/useBizQuery'
import type { ShopInsightsDto } from '@/types/pro'

export const INSIGHT_DAYS = [30, 90, 180, 365] as const
export type InsightDays = (typeof INSIGHT_DAYS)[number]

/** Owner only: visits, repeat customers, the busy hours and barber performance. */
export function useShopInsights(days: InsightDays) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('insights', 'shop', days),
    queryFn: () => api.get<ShopInsightsDto>('/api/insights/shop', { days }),
    enabled: useBizReady(),
    placeholderData: keepPreviousData,
  })
}
