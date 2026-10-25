import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/apiClient'
import { useAuth } from '@/features/auth/AuthProvider'
import type { PublicBookingOp, PublicBookingStatusDto } from '@/types/barbershop'
import type { CustomerAccountDto, CustomerAccountInput, CustomerBookingDto } from '@/types/customer'

/**
 * The signed-in customer's own account and bookings. These routes are NOT business-scoped: the client sends the
 * token but never X-Business-Id (see `customer: true` in apiClient). Keys are per user so a sign-out never leaks data.
 */
const C = { customer: true } as const
const noRetry4xx = (n: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && n < 2

function useCustomerKey() {
  const { user } = useAuth()
  return { userId: user?.id ?? null, key: (...rest: unknown[]) => ['customer', user?.id ?? null, ...rest] as const }
}

export function useCustomerAccount(enabled = true) {
  const { userId, key } = useCustomerKey()
  return useQuery({
    queryKey: key('me'),
    queryFn: () => api.get<CustomerAccountDto>('/api/customer/me', undefined, C),
    enabled: !!userId && enabled,
    retry: noRetry4xx,
  })
}

export function useUpdateCustomerAccount() {
  const qc = useQueryClient()
  const { key } = useCustomerKey()
  return useMutation({
    mutationFn: (input: CustomerAccountInput) => api.put<CustomerAccountDto>('/api/customer/me', input, C),
    onSuccess: (data) => qc.setQueryData(key('me'), data),
  })
}

export function useDeleteCustomerAccount() {
  const qc = useQueryClient()
  const { key } = useCustomerKey()
  return useMutation({
    mutationFn: () => api.delete('/api/customer/me', C),
    onSuccess: () => qc.invalidateQueries({ queryKey: key() }),
  })
}

export function useCustomerBookings(enabled = true) {
  const { userId, key } = useCustomerKey()
  return useQuery({
    queryKey: key('bookings'),
    queryFn: () => api.get<CustomerBookingDto[]>('/api/customer/bookings', undefined, C),
    enabled: !!userId && enabled,
    retry: noRetry4xx,
    refetchInterval: 60_000,
  })
}

export function useCustomerBooking(reference: string) {
  const { userId, key } = useCustomerKey()
  return useQuery({
    queryKey: key('bookings', reference),
    queryFn: () => api.get<PublicBookingStatusDto>(`/api/customer/bookings/${encodeURIComponent(reference)}`, undefined, C),
    enabled: !!userId && !!reference,
    retry: noRetry4xx,
  })
}

export function useCustomerBookingAction(reference: string) {
  const qc = useQueryClient()
  const { key } = useCustomerKey()
  return useMutation({
    mutationFn: ({ op, input }: { op: PublicBookingOp; input: { startsAt?: string | null; note?: string | null } }) =>
      api.post<PublicBookingStatusDto>(`/api/customer/bookings/${encodeURIComponent(reference)}/${op}`, input, C),
    onSuccess: (data) => {
      qc.setQueryData(key('bookings', reference), data)
      void qc.invalidateQueries({ queryKey: key('bookings') })
    },
  })
}
