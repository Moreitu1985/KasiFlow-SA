import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { OpportunityDto, OpportunityInput, OpportunityType, TrackingInput, VerificationStatus } from '@/types/api'

export interface OpportunityQuery {
  type?: OpportunityType | ''
  verification?: VerificationStatus | ''
  search?: string
  savedOnly?: boolean
}

export function useOpportunities(q: OpportunityQuery) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('opportunities', 'list', q),
    queryFn: () => api.get<OpportunityDto[]>('/api/opportunities', { ...q }),
    enabled: useBizReady(),
    placeholderData: keepPreviousData,
  })
}

export function useOpportunity(id: string | null) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('opportunities', 'detail', id),
    queryFn: () => api.get<OpportunityDto>(`/api/opportunities/${id}`),
    enabled: useBizReady() && !!id,
  })
}

export function useCreateOpportunity() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: OpportunityInput) => api.post<OpportunityDto>('/api/opportunities', input),
    onSuccess: () => invalidate(['opportunities']),
  })
}

export function useSaveOpportunity() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, save }: { id: string; save: boolean }) =>
      save ? api.post<OpportunityDto>(`/api/opportunities/${id}/save`) : api.delete<OpportunityDto | undefined>(`/api/opportunities/${id}/save`),
    onSuccess: () => invalidate(['opportunities']),
  })
}

export function useTrackOpportunity() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: TrackingInput }) => api.put<OpportunityDto>(`/api/opportunities/${id}/tracking`, input),
    onSuccess: () => invalidate(['opportunities']),
  })
}
