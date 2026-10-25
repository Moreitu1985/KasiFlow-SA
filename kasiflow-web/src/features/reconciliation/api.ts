import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { LIVE_REFETCH_MS, MONEY_DOMAINS, useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { ReconciliationItemDto, ReconciliationStatus, ReconciliationSummaryDto } from '@/types/automation'

export function useReconciliationSummary() {
  const key = useBizKey()
  return useQuery({
    queryKey: key('reconciliation', 'summary'),
    queryFn: () => api.get<ReconciliationSummaryDto>('/api/reconciliation/summary'),
    enabled: useBizReady(),
    refetchInterval: LIVE_REFETCH_MS,
  })
}

export function useReconciliationQueue(status: ReconciliationStatus) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('reconciliation', 'queue', status),
    queryFn: () => api.get<ReconciliationItemDto[]>('/api/reconciliation/queue', { status }),
    enabled: useBizReady(),
    refetchInterval: LIVE_REFETCH_MS,
  })
}

type Action = { kind: 'match'; id: string; transactionId: string; note?: string } | { kind: 'create-sale' | 'ignore' | 'unmatch'; id: string; note?: string }

export function useReconcileAction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (a: Action) =>
      a.kind === 'match'
        ? api.post<ReconciliationItemDto>(`/api/reconciliation/payments/${a.id}/match`, { transactionId: a.transactionId, note: a.note ?? null })
        : api.post<ReconciliationItemDto>(`/api/reconciliation/payments/${a.id}/${a.kind}`, { note: a.note ?? null }),
    onSuccess: () => invalidate(['reconciliation', 'integrations', 'notifications', ...MONEY_DOMAINS]),
  })
}
