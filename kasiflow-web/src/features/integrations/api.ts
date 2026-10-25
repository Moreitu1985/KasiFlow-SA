import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { LIVE_REFETCH_MS, MONEY_DOMAINS, useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import { useAccess } from '@/features/access/useAccess'
import type { Paged } from '@/types/api'
import type {
  ActivityDto,
  ConnectInput,
  ConnectionTestDto,
  IntegrationsOverviewDto,
  JobDto,
  ProviderPaymentDto,
  SandboxResetDto,
  SettlementDto,
  SimulateInput,
  SimulateResultDto,
} from '@/types/automation'

export function useIntegrations() {
  const key = useBizKey()
  const { can } = useAccess()
  return useQuery({
    queryKey: key('integrations', 'overview'),
    queryFn: () => api.get<IntegrationsOverviewDto>('/api/integrations'),
    enabled: useBizReady() && can('viewIntegrations'),
    refetchInterval: LIVE_REFETCH_MS,
  })
}

export function useConnectionActivity(id: string | null) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('integrations', 'activity', id),
    queryFn: () => api.get<ActivityDto[]>(`/api/integrations/connections/${id}/activity`),
    enabled: useBizReady() && !!id,
    refetchInterval: LIVE_REFETCH_MS,
  })
}

export function useJobs(enabled: boolean) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('integrations', 'jobs'),
    queryFn: () => api.get<JobDto[]>('/api/integrations/jobs'),
    enabled: useBizReady() && enabled,
    refetchInterval: LIVE_REFETCH_MS,
  })
}

export function useProviderPayments(q: { status?: string; reconciliationStatus?: string; page: number; pageSize?: number }) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('reconciliation', 'payments', q),
    queryFn: () => api.get<Paged<ProviderPaymentDto>>('/api/integrations/payments', { ...q, pageSize: q.pageSize ?? 20 }),
    enabled: useBizReady(),
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_REFETCH_MS,
  })
}

export function useSettlements() {
  const key = useBizKey()
  return useQuery({
    queryKey: key('reconciliation', 'settlements'),
    queryFn: () => api.get<SettlementDto[]>('/api/integrations/settlements'),
    enabled: useBizReady(),
    refetchInterval: 30_000,
  })
}

const AFTER_EVENTS = ['integrations', 'reconciliation', 'notifications', 'briefing', ...MONEY_DOMAINS] as const

export function useConnect() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: ConnectInput) => api.post<ConnectionTestDto>('/api/integrations/connections', input),
    onSuccess: () => invalidate(['integrations', 'notifications']),
  })
}

export function useTestConnection() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.post<ConnectionTestDto>(`/api/integrations/connections/${id}/test`),
    onSuccess: () => invalidate(['integrations', 'notifications']),
  })
}

export function useSyncConnection() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/api/integrations/connections/${id}/sync`),
    onSuccess: () => invalidate(['integrations']),
  })
}

export function useDisconnect() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/integrations/connections/${id}`),
    onSuccess: () => invalidate(['integrations']),
  })
}

export function useRetryJob() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/api/integrations/jobs/${id}/retry`),
    onSuccess: () => invalidate(['integrations']),
  })
}

export function useSimulate() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ connectionId, input }: { connectionId: string; input: SimulateInput }) =>
      api.post<SimulateResultDto>(`/api/integrations/connections/${connectionId}/simulate`, input),
    // Events are processed by a background worker; refresh now and let polling pick up the rest.
    onSuccess: () => invalidate([...AFTER_EVENTS]),
  })
}

export function useResetSandbox() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: () => api.post<SandboxResetDto>('/api/integrations/sandbox/reset'),
    onSuccess: () => invalidate([...AFTER_EVENTS]),
  })
}
