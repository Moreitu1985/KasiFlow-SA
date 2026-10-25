import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { EarningsDto, PayTermsDto, PayTermsInput, PayoutInput, PayrollDto } from '@/types/pro'

const noRetry4xx = (n: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && n < 2

/** One barber's statement (their own, or anyone's for the owner). */
export function useEarnings(staffId: string | null | undefined, range: { from: string; to: string }) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('pay', 'earnings', staffId, range.from, range.to),
    queryFn: () => api.get<EarningsDto>(`/api/team/${staffId}/earnings`, range),
    enabled: useBizReady() && !!staffId,
    placeholderData: keepPreviousData,
    retry: noRetry4xx,
  })
}

/** Owner only. */
export function usePayroll(range: { from: string; to: string }) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('pay', 'payroll', range.from, range.to),
    queryFn: () => api.get<PayrollDto>('/api/payroll', range),
    enabled: useBizReady(),
    placeholderData: keepPreviousData,
    retry: noRetry4xx,
  })
}

export function usePayTerms(staffId: string | null | undefined, enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('pay', 'terms', staffId),
    queryFn: () => api.get<PayTermsDto>(`/api/team/${staffId}/pay-terms`),
    enabled: useBizReady() && !!staffId && enabled,
    retry: noRetry4xx,
  })
}

export function useSetPayTerms() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ staffId, input }: { staffId: string; input: PayTermsInput }) => api.put<PayTermsDto>(`/api/team/${staffId}/pay-terms`, input),
    onSuccess: () => invalidate(['pay']),
  })
}

/** Records a payout the owner made (or chair rent received). KasiFlow never moves money. */
export function useRecordPayout() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: PayoutInput) => api.post<EarningsDto>('/api/payroll/payouts', input),
    onSuccess: () => invalidate(['pay', 'transactions', 'dashboard', 'money', 'reports']),
  })
}
