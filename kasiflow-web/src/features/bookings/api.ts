import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { LIVE_REFETCH_MS, MONEY_DOMAINS, useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type {
  AvailabilityDto,
  BookingDetailDto,
  BookingInput,
  BookingPolicyDto,
  BookingSummaryDto,
  CompleteInput,
  ConfirmInput,
  HouseCallListItemDto,
  HouseCallUpdateInput,
  LocationType,
  ProposeInput,
  QuoteDto,
  VisitExpenseInput,
} from '@/types/barbershop'

export interface BookingQuery {
  from: string
  to: string
  status?: string
  staffId?: string
  locationType?: string
}

export function useBookings(q: BookingQuery) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('bookings', 'list', q),
    queryFn: () => api.get<BookingSummaryDto[]>('/api/bookings', { ...q }),
    enabled: useBizReady() && !!q.from && !!q.to && q.from <= q.to,
    placeholderData: keepPreviousData,
    refetchInterval: LIVE_REFETCH_MS * 2,
  })
}

export function useBooking(id: string | undefined) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('bookings', 'detail', id),
    queryFn: () => api.get<BookingDetailDto>(`/api/bookings/${id}`),
    enabled: useBizReady() && !!id,
  })
}

export interface AvailabilityQuery {
  date: string
  serviceIds: string[]
  staffId?: string | null
  locationType?: LocationType
}

export function useAvailability(q: AvailabilityQuery, enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('bookings', 'availability', q),
    queryFn: () =>
      api.get<AvailabilityDto>('/api/bookings/availability', {
        date: q.date,
        serviceIds: q.serviceIds.join(','),
        staffId: q.staffId ?? undefined,
        locationType: q.locationType,
      }),
    enabled: useBizReady() && enabled && !!q.date && q.serviceIds.length > 0,
    placeholderData: keepPreviousData,
  })
}

export function useQuote(input: BookingInput | null) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('bookings', 'quote', input),
    queryFn: () => api.post<QuoteDto>('/api/bookings/quote', input),
    enabled: useBizReady() && !!input && input.items.length > 0,
    placeholderData: keepPreviousData,
    retry: false,
  })
}

export function useCreateBooking() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: BookingInput) => api.post<BookingDetailDto>('/api/bookings', input),
    onSuccess: () => invalidate(['bookings', 'workspace', 'houseCalls', 'notifications']),
  })
}

export type BookingMutation =
  | { kind: 'confirm'; input: ConfirmInput }
  | { kind: 'propose'; input: ProposeInput }
  | { kind: 'accept-proposal'; reason?: string | null }
  | { kind: 'reject-proposal'; reason?: string | null }
  | { kind: 'complete'; input: CompleteInput }
  | { kind: 'no-show'; reason?: string | null }
  | { kind: 'cancel'; reason: string }
  | { kind: 'house-call'; input: HouseCallUpdateInput }
  | { kind: 'expense'; input: VisitExpenseInput }

function send(id: string, m: BookingMutation): Promise<BookingDetailDto> {
  switch (m.kind) {
    case 'confirm':
      return api.post(`/api/bookings/${id}/confirm`, m.input)
    case 'propose':
      return api.post(`/api/bookings/${id}/propose`, m.input)
    case 'complete':
      return api.post(`/api/bookings/${id}/complete`, m.input)
    case 'house-call':
      return api.put(`/api/bookings/${id}/house-call`, m.input)
    case 'expense':
      return api.post(`/api/bookings/${id}/expenses`, m.input)
    default:
      return api.post(`/api/bookings/${id}/${m.kind}`, { reason: m.reason ?? null })
  }
}

/** Every booking action; refreshes bookings, the workspace and (for completion / trip expenses) the money views. */
export function useBookingAction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, m }: { id: string; m: BookingMutation }) => send(id, m),
    onSuccess: (_d, v) =>
      invalidate(
        v.m.kind === 'complete' || v.m.kind === 'expense'
          ? ['workspace', 'notifications', ...MONEY_DOMAINS]
          : ['bookings', 'workspace', 'houseCalls', 'notifications'],
      ),
  })
}

export function useHouseCalls(from: string, to: string) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('houseCalls', from, to),
    queryFn: () => api.get<HouseCallListItemDto[]>('/api/house-calls', { from, to }),
    enabled: useBizReady() && !!from && !!to && from <= to,
    placeholderData: keepPreviousData,
  })
}

export function useBookingPolicy(enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('policies', 'booking'),
    queryFn: () => api.get<BookingPolicyDto>('/api/policies/booking'),
    enabled: useBizReady() && enabled,
  })
}

export function useUpdateBookingPolicy() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: BookingPolicyDto) => api.put<BookingPolicyDto>('/api/policies/booking', input),
    onSuccess: () => invalidate(['policies', 'bookings']),
  })
}
