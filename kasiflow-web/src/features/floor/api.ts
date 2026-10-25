import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady } from '@/hooks/useBizQuery'
import type { FloorDto } from '@/types/barbershop'

/** How often the floor refreshes while the tab is visible (TanStack pauses polling for hidden tabs). */
export const FLOOR_REFETCH_MS = 30_000

/**
 * Manager's live view of today. Keyed under 'bookings' so every booking change (confirm, complete, check-in…) also
 * refreshes the floor straight away.
 */
export function useFloor(enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('bookings', 'floor'),
    queryFn: () => api.get<FloorDto>('/api/floor'),
    enabled: useBizReady() && enabled,
    refetchInterval: FLOOR_REFETCH_MS,
  })
}
