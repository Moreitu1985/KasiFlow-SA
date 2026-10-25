import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { MONEY_DOMAINS, useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type {
  ContactInput,
  CustomerDto,
  Paged,
  PaymentInput,
  ReceivableDetailDto,
  ReceivableDto,
  ReceivableInput,
  ReceivableStatus,
  ReceivableSummaryDto,
} from '@/types/api'

export interface ReceivableQuery {
  status?: ReceivableStatus | 'all'
  filter?: 'all' | 'overdue' | 'upcoming'
  customerId?: string
  page?: number
  pageSize?: number
}

export function useCustomers(search = '', includeArchived = false) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('customers', search, includeArchived),
    queryFn: () => api.get<CustomerDto[]>('/api/customers', { search, includeArchived }),
    enabled: useBizReady(),
    placeholderData: keepPreviousData,
  })
}

export function useCustomer(id: string | undefined) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('customers', 'detail', id),
    queryFn: () => api.get<CustomerDto>(`/api/customers/${id}`),
    enabled: useBizReady() && !!id,
  })
}

export function useSaveCustomer() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ContactInput }) =>
      id ? api.put<CustomerDto>(`/api/customers/${id}`, input) : api.post<CustomerDto>('/api/customers', input),
    onSuccess: () => invalidate(['customers', 'receivables']),
  })
}

export function useReceivables(q: ReceivableQuery) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('receivables', 'list', q),
    queryFn: () => api.get<Paged<ReceivableDto>>('/api/receivables', { ...q }),
    enabled: useBizReady(),
    placeholderData: keepPreviousData,
  })
}

export function useReceivableSummary() {
  const key = useBizKey()
  return useQuery({
    queryKey: key('receivables', 'summary'),
    queryFn: () => api.get<ReceivableSummaryDto>('/api/receivables/summary'),
    enabled: useBizReady(),
  })
}

export function useReceivable(id: string | undefined) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('receivables', 'detail', id),
    queryFn: () => api.get<ReceivableDetailDto>(`/api/receivables/${id}`),
    enabled: useBizReady() && !!id,
  })
}

export function useCreateReceivable() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: ReceivableInput) => api.post<ReceivableDetailDto>('/api/receivables', input),
    onSuccess: () => invalidate(MONEY_DOMAINS),
  })
}

export function useReceivablePayment() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: PaymentInput }) => api.post<ReceivableDetailDto>(`/api/receivables/${id}/payments`, input),
    onSuccess: () => invalidate(MONEY_DOMAINS),
  })
}

export function useWriteOffReceivable() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => api.post<ReceivableDetailDto>(`/api/receivables/${id}/write-off`, { reason }),
    onSuccess: () => invalidate(MONEY_DOMAINS),
  })
}
