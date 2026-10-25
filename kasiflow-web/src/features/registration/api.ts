import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import { useQueryClient } from '@tanstack/react-query'
import { ME_KEY } from '@/features/business/BusinessProvider'
import type { RegistrationDto, RegistrationStatus } from '@/types/api'

export function useRegistration() {
  const key = useBizKey()
  return useQuery({ queryKey: key('registration'), queryFn: () => api.get<RegistrationDto>('/api/registration'), enabled: useBizReady() })
}

export function useUpdateRegistrationItem() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ key, completed, notes }: { key: string; completed: boolean; notes?: string | null }) =>
      api.put<unknown>(`/api/registration/items/${encodeURIComponent(key)}`, { completed, notes }),
    onSuccess: () => invalidate(['registration', 'dashboard', 'funding']),
  })
}

export function useUpdateRegistrationStatus() {
  const invalidate = useInvalidate()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (registrationStatus: RegistrationStatus) => api.put<unknown>('/api/registration/status', { registrationStatus }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ME_KEY })
      return invalidate(['registration', 'dashboard', 'funding'])
    },
  })
}
