import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady } from '@/hooks/useBizQuery'
import type { HouseCallMapDto } from '@/types/pro'

/** Today's house calls with the pins customers dropped and the spots barbers chose to share. Refreshes like the floor. */
export function useHouseCallMap(date?: string) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('bookings', 'map', date ?? 'today'),
    queryFn: () => api.get<HouseCallMapDto>('/api/house-calls/map', { date }),
    enabled: useBizReady(),
    refetchInterval: 30_000,
  })
}
