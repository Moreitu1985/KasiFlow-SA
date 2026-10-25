import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api, ApiError, buildUrl } from '@/lib/apiClient'
import type { ShopCardDto } from '@/types/customer'

const noRetry4xx = (n: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && n < 2

/** Published shops for the customer catalogue. Anonymous: no token or business header is sent. */
export function usePublicShops(q: string) {
  const term = q.trim()
  return useQuery({
    queryKey: ['public-shops', term],
    queryFn: () => api.get<ShopCardDto[]>('/api/public/shops', { q: term || undefined }, { anonymous: true }),
    placeholderData: keepPreviousData,
    retry: noRetry4xx,
    staleTime: 60_000,
  })
}

/** Cover photos come as API-relative paths. */
export function coverUrl(path: string | null): string | null {
  return path ? buildUrl(path) : null
}
