import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { ME_KEY } from './BusinessProvider'
import type { BusinessDto, BusinessInput } from '@/types/api'

export function useCreateBusiness() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: BusinessInput) => api.post<BusinessDto>('/api/businesses', input),
    onSuccess: () => {
      // Not awaited: onboarding moves to step 2 before the refreshed list arrives.
      void qc.invalidateQueries({ queryKey: ME_KEY })
    },
  })
}

export function useUpdateBusiness() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: BusinessInput }) => api.put<BusinessDto>(`/api/businesses/${id}`, input),
    onSuccess: (_data, { id }) => {
      void qc.invalidateQueries({ queryKey: ME_KEY })
      void qc.invalidateQueries({ queryKey: ['biz', id] })
    },
  })
}
