import { useMutation, useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { CustomerAccountSummaryDto, HouseCallSafetyDto, SafetyCheckinInput, SafetyNoteInput } from '@/types/customer'

const noRetry4xx = (n: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && n < 2

/** House-call safety state for one booking. Polled so a help request or an overdue check-in shows up for managers. */
export function useSafety(bookingId: string | null | undefined, enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('bookings', 'safety', bookingId),
    queryFn: () => api.get<HouseCallSafetyDto>(`/api/bookings/${bookingId}/safety`),
    enabled: useBizReady() && !!bookingId && enabled,
    refetchInterval: 30_000,
    retry: noRetry4xx,
  })
}

export function useCheckIn(bookingId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: SafetyCheckinInput) => api.post<HouseCallSafetyDto>(`/api/bookings/${bookingId}/safety/check-ins`, input),
    onSuccess: () => invalidate(['bookings', 'alerts', 'notifications', 'workspace']),
  })
}

/** The verified customer account behind a booking, as this shop sees it (404 when the booking was not made with an account). */
export function useBookingCustomerAccount(bookingId: string | null | undefined, enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('bookings', 'customer-account', bookingId),
    queryFn: () => api.get<CustomerAccountSummaryDto>(`/api/bookings/${bookingId}/customer-account`),
    enabled: useBizReady() && !!bookingId && enabled,
    retry: noRetry4xx,
  })
}

export function useAddSafetyNote(bookingId: string) {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: SafetyNoteInput) => api.post<CustomerAccountSummaryDto>(`/api/bookings/${bookingId}/safety-notes`, input),
    onSuccess: () => invalidate(['bookings']),
  })
}

export function useHouseCallBlock() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ userId, block, reason }: { userId: string; block: boolean; reason: string }) =>
      api.post<CustomerAccountSummaryDto>(`/api/customer-accounts/${userId}/house-call-block${block ? '' : '/lift'}`, { reason }),
    onSuccess: () => invalidate(['bookings']),
  })
}
