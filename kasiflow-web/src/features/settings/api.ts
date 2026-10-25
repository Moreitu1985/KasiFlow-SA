import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { MONEY_DOMAINS, useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { PublicProfileSettingsDto, PublicProfileSettingsInput, SettingsDto } from '@/types/api'

export function useSettings(enabled = true) {
  const key = useBizKey()
  return useQuery({ queryKey: key('settings'), queryFn: () => api.get<SettingsDto>('/api/settings'), enabled: useBizReady() && enabled })
}

export function useUpdateSettings() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: SettingsDto) => api.put<SettingsDto>('/api/settings', input),
    onSuccess: () => invalidate(['settings', ...MONEY_DOMAINS]),
  })
}

export function usePublicProfileSettings(enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('publicProfile'),
    queryFn: () => api.get<PublicProfileSettingsDto>('/api/public-profile'),
    enabled: useBizReady() && enabled,
  })
}

export function useUpdatePublicProfile() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: PublicProfileSettingsInput) => api.put<PublicProfileSettingsDto>('/api/public-profile', input),
    onSuccess: () => invalidate(['publicProfile', 'funding']),
  })
}
