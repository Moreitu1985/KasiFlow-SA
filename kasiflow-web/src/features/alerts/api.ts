import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { AlertDto, AlertStatus, AlertSummaryDto } from '@/types/barbershop'

export function useAlerts(status: AlertStatus | 'all' | '', severity: string) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('alerts', status, severity),
    queryFn: () => api.get<AlertSummaryDto>('/api/alerts', { status: status || undefined, severity: severity || undefined }),
    enabled: useBizReady(),
    placeholderData: keepPreviousData,
  })
}

export function useSetAlertStatus() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, status, note }: { id: string; status: AlertStatus; note?: string | null }) =>
      api.post<AlertDto>(`/api/alerts/${id}/status`, { status, note: note ?? null }),
    onSuccess: () => invalidate(['alerts', 'notifications', 'briefing']),
  })
}
