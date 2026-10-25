import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import { useAccess } from '@/features/access/useAccess'
import type { ProductDto, ProductInput, ReorderSuggestionDto, StockMovementDto, StockMovementStatus } from '@/types/automation'

export function useProducts(q: { search?: string; includeInactive?: boolean }, opts: { enabled?: boolean } = {}) {
  const key = useBizKey()
  const { can } = useAccess()
  return useQuery({
    queryKey: key('inventory', 'products', q),
    queryFn: () => api.get<ProductDto[]>('/api/inventory/products', { search: q.search || undefined, includeInactive: q.includeInactive || undefined }),
    enabled: useBizReady() && can('viewInventory') && (opts.enabled ?? true),
    placeholderData: keepPreviousData,
  })
}

export function useMovements(q: { productId?: string; branchId?: string; status?: StockMovementStatus }, enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('inventory', 'movements', q),
    queryFn: () => api.get<StockMovementDto[]>('/api/inventory/movements', q),
    enabled: useBizReady() && enabled,
    refetchInterval: 30_000,
  })
}

export function useReorderSuggestions(onlyNeeded: boolean) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('inventory', 'reorder', onlyNeeded),
    queryFn: () => api.get<ReorderSuggestionDto[]>('/api/inventory/reorder-suggestions', { onlyNeeded: onlyNeeded || undefined }),
    enabled: useBizReady(),
  })
}

export function useSaveProduct() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ProductInput }) =>
      id ? api.put<ProductDto>(`/api/inventory/products/${id}`, input) : api.post<ProductDto>('/api/inventory/products', input),
    onSuccess: () => invalidate(['inventory']),
  })
}

export function useReceiveStock() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { productId: string; branchId: string; quantity: number; unitCostCents?: number | null; note?: string | null }) =>
      api.post<ProductDto>('/api/inventory/receive', input),
    onSuccess: () => invalidate(['inventory', 'notifications', 'briefing']),
  })
}

export function useAdjustStock() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { productId: string; branchId: string; type: string; quantityDelta: number; reason: string }) =>
      api.post<StockMovementDto>('/api/inventory/adjustments', input),
    onSuccess: () => invalidate(['inventory', 'notifications']),
  })
}

export function useDecideAdjustment() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, approve, note }: { id: string; approve: boolean; note?: string }) =>
      api.post<StockMovementDto>(`/api/inventory/adjustments/${id}/${approve ? 'approve' : 'reject'}`, { note: note ?? null }),
    onSuccess: () => invalidate(['inventory', 'notifications']),
  })
}

export function useTransferStock() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { productId: string; fromBranchId: string; toBranchId: string; quantity: number; note?: string | null }) =>
      api.post<ProductDto>('/api/inventory/transfers', input),
    onSuccess: () => invalidate(['inventory']),
  })
}
