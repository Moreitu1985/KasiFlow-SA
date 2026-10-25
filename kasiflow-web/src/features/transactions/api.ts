import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { MONEY_DOMAINS, useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { Paged, TransactionCategories, TransactionDto, TransactionInput, TransactionQuery } from '@/types/api'

export function useTransactions(q: TransactionQuery) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('transactions', 'list', q),
    queryFn: () => api.get<Paged<TransactionDto>>('/api/transactions', { ...q }),
    enabled: useBizReady(),
    placeholderData: keepPreviousData,
  })
}

export function useTransaction(id: string | undefined) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('transactions', 'detail', id),
    queryFn: () => api.get<TransactionDto>(`/api/transactions/${id}`),
    enabled: useBizReady() && !!id,
  })
}

export function useCategories() {
  const key = useBizKey()
  return useQuery({
    queryKey: key('categories'),
    queryFn: () => api.get<TransactionCategories>('/api/transactions/categories'),
    enabled: useBizReady(),
    staleTime: 60 * 60_000,
  })
}

export function useRecentTransactions(limit = 8) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('transactions', 'recent', limit),
    queryFn: () => api.get<TransactionDto[]>('/api/dashboard/recent-transactions', { limit }),
    enabled: useBizReady(),
  })
}

export function useSaveTransaction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input, idempotencyKey }: { id?: string; input: TransactionInput; idempotencyKey?: string }) =>
      id
        ? api.put<TransactionDto>(`/api/transactions/${id}`, input)
        : api.post<TransactionDto>('/api/transactions', input, idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : undefined),
    onSuccess: () => invalidate(MONEY_DOMAINS),
  })
}

export function useVoidTransaction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      api.post<TransactionDto>(`/api/transactions/${id}/void`, { reason }),
    onSuccess: () => invalidate(MONEY_DOMAINS),
  })
}
