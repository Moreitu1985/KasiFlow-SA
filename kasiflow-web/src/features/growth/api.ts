import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { ForecastDto, GrowthRuleDto, RecommendationDto, RecommendationStatus, RefreshResultDto, Severity } from '@/types/api'

export function useForecast(days?: number) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('forecast', days ?? 'default'),
    queryFn: () => api.get<ForecastDto>('/api/growth/forecast', { days }),
    enabled: useBizReady(),
  })
}

export function useRecommendations(status: RecommendationStatus | 'all', severity: Severity | '') {
  const key = useBizKey()
  return useQuery({
    queryKey: key('growth', 'recommendations', status, severity),
    queryFn: () => api.get<RecommendationDto[]>('/api/growth/recommendations', { status, severity }),
    enabled: useBizReady(),
  })
}

export function useGrowthRules() {
  const key = useBizKey()
  return useQuery({
    queryKey: key('growth', 'rules'),
    queryFn: () => api.get<GrowthRuleDto[]>('/api/growth/rules'),
    enabled: useBizReady(),
    staleTime: 60 * 60_000,
  })
}

export function useUpdateRecommendation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: RecommendationStatus; note?: string }) =>
      api.patch<RecommendationDto>(`/api/growth/recommendations/${id}`, { status, note }),
    onSuccess: () => invalidate(['growth', 'dashboard']),
  })
}

export function useRefreshGrowth() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: () => api.post<RefreshResultDto>('/api/growth/refresh'),
    onSuccess: () => invalidate(['growth', 'dashboard', 'forecast']),
  })
}
