import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { MONEY_DOMAINS, useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { DebtAccountDto, DebtChargePolicyDto, DebtChargePolicyInput, OverdueReportDto, ReminderInput } from '@/types/barbershop'

export function useOverdueReport() {
  const key = useBizKey()
  return useQuery({ queryKey: key('debts', 'overdue'), queryFn: () => api.get<OverdueReportDto>('/api/debts/overdue-report'), enabled: useBizReady() })
}

export function useDebtAccount(id: string | undefined) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('debts', 'account', id),
    queryFn: () => api.get<DebtAccountDto>(`/api/debts/${id}/account`),
    enabled: useBizReady() && !!id,
  })
}

export type DebtMutation =
  | { kind: 'dispute' | 'resolve-dispute'; reason: string }
  | { kind: 'reminder'; input: ReminderInput }
  | { kind: 'charge'; chargeId: string; decision: 'waive' | 'reverse'; reason: string }

export function useDebtAction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, m }: { id: string; m: DebtMutation }) => {
      switch (m.kind) {
        case 'reminder':
          return api.post<DebtAccountDto>(`/api/debts/${id}/reminders`, m.input)
        case 'charge':
          return api.post<DebtAccountDto>(`/api/debts/${id}/charges/${m.chargeId}/${m.decision}`, { reason: m.reason })
        default:
          return api.post<DebtAccountDto>(`/api/debts/${id}/${m.kind}`, { reason: m.reason })
      }
    },
    onSuccess: () => invalidate(MONEY_DOMAINS),
  })
}

export function useDebtPolicy(enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('policies', 'debt-charge'),
    queryFn: () => api.get<DebtChargePolicyDto>('/api/policies/debt-charge'),
    enabled: useBizReady() && enabled,
  })
}

export function useUpdateDebtPolicy() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: DebtChargePolicyInput) => api.put<DebtChargePolicyDto>('/api/policies/debt-charge', input),
    onSuccess: () => invalidate(['policies', 'debts']),
  })
}
