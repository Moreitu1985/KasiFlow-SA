import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { LIVE_REFETCH_MS, useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type {
  ServiceDto,
  ServiceInput,
  StaffProfileDto,
  StaffProfileInput,
  StaffServiceDto,
  StaffServiceInput,
  StaffStatusDto,
  StatusInput,
  TimeOffDto,
  TimeOffInput,
  WorkingHoursDto,
  WorkspaceDto,
} from '@/types/barbershop'
import type { RegisterBarberInput, RegisterBarberResultDto } from '@/types/customer'

/** The signed-in person's workspace. Polled so colleagues' statuses stay fresh while the tab is visible. */
export function useWorkspace() {
  const key = useBizKey()
  return useQuery({
    queryKey: key('workspace'),
    queryFn: () => api.get<WorkspaceDto>('/api/workspace'),
    enabled: useBizReady(),
    refetchInterval: LIVE_REFETCH_MS * 2,
  })
}

export function useTeam(enabled = true) {
  const key = useBizKey()
  return useQuery({ queryKey: key('team'), queryFn: () => api.get<StaffProfileDto[]>('/api/team'), enabled: useBizReady() && enabled })
}

export function useSaveProfile() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: StaffProfileInput }) =>
      id ? api.put<StaffProfileDto>(`/api/team/${id}`, input) : api.post<StaffProfileDto>('/api/team', input),
    onSuccess: () => invalidate(['team', 'workspace']),
  })
}

export function useSetStatus() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ staffId, input }: { staffId: string; input: StatusInput }) => api.put<StaffStatusDto>(`/api/team/${staffId}/status`, input),
    onSuccess: () => invalidate(['team', 'workspace']),
  })
}

export function useSetHours() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ staffId, hours }: { staffId: string; hours: WorkingHoursDto[] }) => api.put<WorkingHoursDto[]>(`/api/team/${staffId}/hours`, hours),
    onSuccess: () => invalidate(['team', 'workspace']),
  })
}

export function useAddTimeOff() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ staffId, input }: { staffId: string; input: TimeOffInput }) => api.post<TimeOffDto>(`/api/team/${staffId}/time-off`, input),
    onSuccess: () => invalidate(['team', 'workspace']),
  })
}

export function useDeleteTimeOff() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ staffId, id }: { staffId: string; id: string }) => api.delete(`/api/team/${staffId}/time-off/${id}`),
    onSuccess: () => invalidate(['team', 'workspace']),
  })
}

export function useSetStaffServices() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ staffId, input }: { staffId: string; input: StaffServiceInput[] }) => api.put<StaffServiceDto[]>(`/api/team/${staffId}/services`, input),
    onSuccess: () => invalidate(['team', 'workspace', 'services']),
  })
}

export function useServices(includeInactive = false, enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('services', includeInactive),
    queryFn: () => api.get<ServiceDto[]>('/api/services', { includeInactive }),
    enabled: useBizReady() && enabled,
  })
}

export function useSaveService() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: ServiceInput }) =>
      id ? api.put<ServiceDto>(`/api/services/${id}`, input) : api.post<ServiceDto>('/api/services', input),
    onSuccess: () => invalidate(['services', 'team']),
  })
}

/** Owner-side "Register a barber": profile, services, hours and (optionally) a login invitation in one step. */
export function useRegisterBarber() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: (input: RegisterBarberInput) => api.post<RegisterBarberResultDto>('/api/team/register-barber', input),
    onSuccess: () => invalidate(['team', 'workspace', 'staff']),
  })
}

/** Creates a login link for a barber profile that has no login yet. Nothing is sent: the owner shares the link. */
export function useLoginInvite() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ staffId, email }: { staffId: string; email: string }) => api.post<RegisterBarberResultDto>(`/api/team/${staffId}/login-invite`, { email }),
    onSuccess: () => invalidate(['team', 'staff']),
  })
}
