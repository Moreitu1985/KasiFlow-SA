import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, buildUrl } from '@/lib/apiClient'
import type {
  AvailabilityDto,
  LocationType,
  PublicActionInput,
  PublicBookingCreatedDto,
  PublicBookingInfoDto,
  PublicBookingInput,
  PublicBookingOp,
  PublicBookingStatusDto,
} from '@/types/barbershop'

const noRetry4xx = (n: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && n < 2

export function usePublicBookingInfo(slug: string, enabled: boolean) {
  return useQuery({
    queryKey: ['public-booking', slug, 'info'],
    queryFn: () => api.get<PublicBookingInfoDto>(`/api/public/profiles/${encodeURIComponent(slug)}/booking`, undefined, { anonymous: true }),
    enabled,
    retry: noRetry4xx,
  })
}

export function usePublicAvailability(
  slug: string,
  q: { date: string; serviceIds: string[]; staffId?: string | null; locationType: LocationType },
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['public-booking', slug, 'availability', q],
    queryFn: () =>
      api.get<AvailabilityDto>(
        `/api/public/profiles/${encodeURIComponent(slug)}/availability`,
        { date: q.date, serviceIds: q.serviceIds.join(','), staffId: q.staffId ?? undefined, locationType: q.locationType },
        { anonymous: true },
      ),
    enabled: enabled && !!q.date && q.serviceIds.length > 0,
    placeholderData: keepPreviousData,
    retry: noRetry4xx,
  })
}

/** Public routes are anonymous: no Authorization or X-Business-Id header is sent. */
function publicPost<T>(path: string, body: unknown): Promise<T> {
  return api.post<T>(path, body, { anonymous: true })
}

/**
 * Creating a booking needs the customer's one-time-code session (Bearer token, no business header). A 401 is handled
 * on the page (the "Verify to book" card), not by a global redirect.
 */
export function useCreatePublicBooking(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: PublicBookingInput) =>
      api.post<PublicBookingCreatedDto>(`/api/public/profiles/${encodeURIComponent(slug)}/bookings`, input, { customer: true, soft401: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['customer'] }),
  })
}

/** Public portfolio photos are served by the API without auth; the DTO carries an API-relative path. */
export function publicPhotoUrl(path: string): string {
  return buildUrl(path)
}

export function usePublicBookingStatus(reference: string, token: string) {
  return useQuery({
    queryKey: ['public-booking', 'status', reference, token],
    queryFn: () => api.get<PublicBookingStatusDto>(`/api/public/bookings/${encodeURIComponent(reference)}`, { t: token }, { anonymous: true }),
    enabled: !!reference && !!token,
    retry: noRetry4xx,
  })
}

export function usePublicBookingAction(reference: string) {
  return useMutation({
    mutationFn: ({ op, input }: { op: PublicBookingOp; input: PublicActionInput }) =>
      publicPost<PublicBookingStatusDto>(`/api/public/bookings/${encodeURIComponent(reference)}/${op}`, input),
  })
}
