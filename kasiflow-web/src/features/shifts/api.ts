import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { ShiftDto } from '@/types/automation'

/** The signed-in person's open shift, or null (the API answers 204 when there is none). */
export function useCurrentShift(enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('shifts', 'current'),
    queryFn: async () => (await api.get<ShiftDto | undefined>('/api/shifts/current')) ?? null,
    enabled: useBizReady() && enabled,
    refetchInterval: 20_000,
  })
}

export function useShifts(status: string, enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('shifts', 'list', status),
    queryFn: () => api.get<ShiftDto[]>('/api/shifts', { status: status || undefined }),
    enabled: useBizReady() && enabled,
    refetchInterval: 30_000,
  })
}

const AFTER = ['shifts', 'notifications', 'briefing'] as const

export function useOpenShift() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: { branchId?: string | null; openingFloatCents: number }) => api.post<ShiftDto>('/api/shifts/open', input),
    onSuccess: () => invalidate([...AFTER]),
  })
}

export function useCashMovement() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; kind: 'cash_drop' | 'float_top_up'; amountCents: number; note?: string | null }) =>
      api.post<ShiftDto>(`/api/shifts/${id}/cash-movements`, input),
    onSuccess: () => invalidate([...AFTER]),
  })
}

export function useCloseShift() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, ...input }: { id: string; countedCashCents: number; note?: string | null }) => api.post<ShiftDto>(`/api/shifts/${id}/close`, input),
    onSuccess: () => invalidate([...AFTER, 'growth', 'dashboard']),
  })
}

export function useReviewShift() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, note }: { id: string; note?: string | null }) => api.post<ShiftDto>(`/api/shifts/${id}/review`, { note: note ?? null }),
    onSuccess: () => invalidate([...AFTER, 'growth']),
  })
}
