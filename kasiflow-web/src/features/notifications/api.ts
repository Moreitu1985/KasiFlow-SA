import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { BriefingDto, NotificationListDto, NotificationPreferencesDto } from '@/types/automation'

/** Polled every 30 s. TanStack Query pauses interval refetches while the tab is hidden (refetchIntervalInBackground is false). */
export function useNotifications() {
  const key = useBizKey()
  return useQuery({
    queryKey: key('notifications', 'list'),
    queryFn: () => api.get<NotificationListDto>('/api/notifications'),
    enabled: useBizReady(),
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    staleTime: 10_000,
  })
}

export function useMarkRead() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string | null) => (id ? api.post<void>(`/api/notifications/${id}/read`) : api.post<void>('/api/notifications/read-all')),
    onSuccess: () => invalidate(['notifications']),
  })
}

export function useNotificationPreferences() {
  const key = useBizKey()
  return useQuery({
    queryKey: key('notifications', 'preferences'),
    queryFn: () => api.get<NotificationPreferencesDto>('/api/notifications/preferences'),
    enabled: useBizReady(),
  })
}

export function useUpdatePreferences() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: NotificationPreferencesDto) => api.put<NotificationPreferencesDto>('/api/notifications/preferences', input),
    onSuccess: () => invalidate(['notifications']),
  })
}

export function useBriefing() {
  const key = useBizKey()
  return useQuery({
    queryKey: key('briefing'),
    queryFn: () => api.get<BriefingDto>('/api/briefing'),
    enabled: useBizReady(),
    refetchInterval: 5 * 60_000,
  })
}
