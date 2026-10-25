import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import { ME_KEY } from '@/features/business/BusinessProvider'
import type {
  BusinessSummaryForJoinDto,
  InvitationCreatedDto,
  InvitationInput,
  RoleChangeInput,
  StaffMemberDto,
  StaffOverviewDto,
  StaffPerformanceDto,
} from '@/types/automation'

export function useStaffOverview() {
  const key = useBizKey()
  return useQuery({ queryKey: key('staff', 'overview'), queryFn: () => api.get<StaffOverviewDto>('/api/staff'), enabled: useBizReady() })
}

export function useStaffPerformance(from: string, to: string, enabled: boolean) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('staff', 'performance', from, to),
    queryFn: () => api.get<StaffPerformanceDto>('/api/staff/performance', { from, to }),
    enabled: useBizReady() && enabled && !!from && !!to && from <= to,
  })
}

export function useInvite() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: InvitationInput) => api.post<InvitationCreatedDto>('/api/staff/invitations', input),
    onSuccess: () => invalidate(['staff']),
  })
}

export function useRevokeInvitation() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (id: string) => api.delete(`/api/staff/invitations/${id}`),
    onSuccess: () => invalidate(['staff']),
  })
}

export function useChangeRole() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: RoleChangeInput }) => api.put<StaffMemberDto>(`/api/staff/${userId}/role`, input),
    onSuccess: () => invalidate(['staff']),
  })
}

export function useSetMemberActive() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ userId, active }: { userId: string; active: boolean }) => api.post<void>(`/api/staff/${userId}/${active ? 'reactivate' : 'deactivate'}`),
    onSuccess: () => invalidate(['staff']),
  })
}

/** Not business-scoped: the invited person is not a member yet. */
export function useAcceptInvitation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (token: string) => api.post<BusinessSummaryForJoinDto>('/api/invitations/accept', { token }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ME_KEY }),
  })
}
