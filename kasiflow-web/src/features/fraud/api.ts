import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { FraudIncidentDto, FraudIncidentInput, IncidentStatus } from '@/types/api'

export function useIncidents(status: IncidentStatus | '') {
  const key = useBizKey()
  return useQuery({
    queryKey: key('fraud', status),
    queryFn: () => api.get<FraudIncidentDto[]>('/api/fraud/incidents', { status }),
    enabled: useBizReady(),
  })
}

export function useSaveIncident() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: FraudIncidentInput }) =>
      id ? api.put<FraudIncidentDto>(`/api/fraud/incidents/${id}`, input) : api.post<FraudIncidentDto>('/api/fraud/incidents', input),
    onSuccess: () => invalidate(['fraud']),
  })
}
