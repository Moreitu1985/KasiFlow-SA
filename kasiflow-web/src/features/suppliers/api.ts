import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { MONEY_DOMAINS, useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { ContactInput, Paged, PayableDetailDto, PayableDto, PayableInput, PayableStatus, PayableSummaryDto, PaymentInput, SupplierDto } from '@/types/api'

export interface PayableQuery {
  status?: PayableStatus | 'all'
  filter?: 'all' | 'overdue' | 'due_soon'
  supplierId?: string
  page?: number
  pageSize?: number
}

export function useSuppliers(search = '', includeArchived = false) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('suppliers', search, includeArchived),
    queryFn: () => api.get<SupplierDto[]>('/api/suppliers', { search, includeArchived }),
    enabled: useBizReady(),
    placeholderData: keepPreviousData,
  })
}

export function useSaveSupplier() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ContactInput }) =>
      id ? api.put<SupplierDto>(`/api/suppliers/${id}`, input) : api.post<SupplierDto>('/api/suppliers', input),
    onSuccess: () => invalidate(['suppliers', 'payables']),
  })
}

export function usePayables(q: PayableQuery) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('payables', 'list', q),
    queryFn: () => api.get<Paged<PayableDto>>('/api/payables', { ...q }),
    enabled: useBizReady(),
    placeholderData: keepPreviousData,
  })
}

export function usePayableSummary() {
  const key = useBizKey()
  return useQuery({
    queryKey: key('payables', 'summary'),
    queryFn: () => api.get<PayableSummaryDto>('/api/payables/summary'),
    enabled: useBizReady(),
  })
}

export function usePayable(id: string | undefined) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('payables', 'detail', id),
    queryFn: () => api.get<PayableDetailDto>(`/api/payables/${id}`),
    enabled: useBizReady() && !!id,
  })
}

export function useCreatePayable() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: PayableInput) => api.post<PayableDetailDto>('/api/payables', input),
    onSuccess: () => invalidate(MONEY_DOMAINS),
  })
}

export function usePayablePayment() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PaymentInput }) => api.post<PayableDetailDto>(`/api/payables/${id}/payments`, input),
    onSuccess: () => invalidate(MONEY_DOMAINS),
  })
}

export function useCancelPayable() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<PayableDetailDto>(`/api/payables/${id}/cancel`, { reason }),
    onSuccess: () => invalidate(MONEY_DOMAINS),
  })
}
