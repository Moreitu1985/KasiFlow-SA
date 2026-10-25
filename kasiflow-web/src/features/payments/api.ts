import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { MONEY_DOMAINS, useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { PaymentProofDto, ProofStatus } from '@/types/barbershop'

export function useProofs(status: ProofStatus | '', enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('proofs', status),
    queryFn: () => api.get<PaymentProofDto[]>('/api/payment-proofs', { status: status || undefined }),
    enabled: useBizReady() && enabled,
  })
}

export interface ProofUpload {
  file: File
  claimedAmountCents?: number | null
  claimedReference?: string | null
  payerName?: string | null
  transactionId?: string | null
  bookingId?: string | null
  receivableId?: string | null
}

export function useUploadProof() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (u: ProofUpload) => {
      const form = new FormData()
      form.append('file', u.file)
      if (u.claimedAmountCents) form.append('claimedAmountCents', String(u.claimedAmountCents))
      if (u.claimedReference) form.append('claimedReference', u.claimedReference)
      if (u.payerName) form.append('payerName', u.payerName)
      if (u.transactionId) form.append('transactionId', u.transactionId)
      if (u.bookingId) form.append('bookingId', u.bookingId)
      if (u.receivableId) form.append('receivableId', u.receivableId)
      return api.upload<PaymentProofDto>('/api/payment-proofs', form)
    },
    onSuccess: () => invalidate(['proofs', 'alerts']),
  })
}

export function useDecideProof() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, confirm, note }: { id: string; confirm: boolean; note: string }) =>
      api.post<PaymentProofDto>(`/api/payment-proofs/${id}/${confirm ? 'confirm-in-bank' : 'reject'}`, { note }),
    onSuccess: () => invalidate(MONEY_DOMAINS),
  })
}

/** Opens the stored proof in a new tab. The file needs the Authorization header, so it is fetched as a Blob first. */
export async function openProofFile(id: string): Promise<void> {
  // Open the tab synchronously (inside the click) so pop-up blockers allow it, then point it at the blob.
  const win = window.open('', '_blank')
  try {
    const blob = await api.blob(`/api/payment-proofs/${id}/file`)
    const url = URL.createObjectURL(blob)
    if (win) win.location.href = url
    else window.location.assign(url)
    setTimeout(() => URL.revokeObjectURL(url), 60_000)
  } catch (e) {
    win?.close()
    throw e
  }
}
