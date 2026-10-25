import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import type { BranchDto, BranchInput } from '@/types/automation'

/** Branches the signed-in person can see (branch-scoped roles only see their own). Open to every member. */
export function useBranches() {
  const key = useBizKey()
  return useQuery({
    queryKey: key('branches'),
    queryFn: () => api.get<BranchDto[]>('/api/branches'),
    enabled: useBizReady(),
    staleTime: 5 * 60_000,
  })
}

export function useSaveBranch() {
  const invalidate = useInvalidate()
  return useMutation({
    mutationFn: ({ id, input }: { id?: string; input: BranchInput }) =>
      id ? api.put<BranchDto>(`/api/branches/${id}`, input) : api.post<BranchDto>('/api/branches', input),
    onSuccess: () => invalidate(['branches', 'staff']),
  })
}
