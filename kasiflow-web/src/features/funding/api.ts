import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { FundingProfileDto, FundingReadinessDto } from '@/types/api'

export function useFundingReadiness() {
  const key = useBizKey()
  return useQuery({ queryKey: key('funding'), queryFn: () => api.get<FundingReadinessDto>('/api/funding-readiness'), enabled: useBizReady() })
}

export function useUpdateFundingItem() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ key, completed, notes }: { key: string; completed: boolean; notes?: string | null }) =>
      api.put<unknown>(`/api/funding-readiness/items/${encodeURIComponent(key)}`, { completed, notes }),
    onSuccess: () => invalidate(['funding', 'dashboard']),
  })
}

export function useUpdateFundingProfile() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: FundingProfileDto) => api.put<unknown>('/api/funding-readiness/profile', input),
    onSuccess: () => invalidate(['funding', 'dashboard', 'reports']),
  })
}
