import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { SupplierBankDetailDto, SupplierBankInput, VerifyBankInput } from '@/types/barbershop'

export function useBankDetails(supplierId: string | undefined) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('bankDetails', supplierId),
    queryFn: () => api.get<SupplierBankDetailDto[]>(`/api/suppliers/${supplierId}/bank-details`),
    enabled: useBizReady() && !!supplierId,
  })
}

export function useBankAction() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ supplierId, m }: { supplierId: string; m: { kind: 'add'; input: SupplierBankInput } | { kind: 'verify' | 'reject'; id: string; input: VerifyBankInput } }) =>
      m.kind === 'add'
        ? api.post<SupplierBankDetailDto[]>(`/api/suppliers/${supplierId}/bank-details`, m.input)
        : api.post<SupplierBankDetailDto[]>(`/api/suppliers/${supplierId}/bank-details/${m.id}/${m.kind}`, m.input),
    onSuccess: () => invalidate(['bankDetails', 'alerts', 'notifications']),
  })
}
