import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '@/lib/apiClient'
import { useBizKey, useBizReady, useInvalidate } from '@/hooks/useBizQuery'
import { actionPath } from '@/lib/queue'
import type { PublicQueueDto, PublicTicketCreatedDto, PublicTicketDto, QueueAction, QueueActionInput, QueueBoardDto, QueueJoinInput } from '@/types/pro'

/** How often the queue board refreshes while the tab is visible. */
export const QUEUE_REFETCH_MS = 12_000

const noRetry4xx = (n: number, err: unknown) => !(err instanceof ApiError && err.status < 500) && n < 2

/** Today's walk-in queue for the desk, managers, the owner and barbers. */
export function useQueueBoard(enabled = true) {
  const key = useBizKey()
  return useQuery({
    queryKey: key('queue', 'board'),
    queryFn: () => api.get<QueueBoardDto>('/api/queue'),
    enabled: useBizReady() && enabled,
    refetchInterval: QUEUE_REFETCH_MS,
    retry: noRetry4xx,
  })
}

/** Every queue change returns the fresh board: put it straight into the cache, then refresh what it touches. */
function useBoardWriter() {
  const qc = useQueryClient()
  const key = useBizKey()
  const invalidate = useInvalidate()
  return (board: QueueBoardDto, money = false) => {
    qc.setQueryData(key('queue', 'board'), board)
    void invalidate(money ? ['bookings', 'workspace', 'team', 'pay', 'transactions', 'dashboard', 'money', 'shifts'] : ['workspace', 'team'])
  }
}

export function useAddWalkIn() {
  const write = useBoardWriter()
  return useMutation({
    mutationFn: (input: QueueJoinInput) => api.post<QueueBoardDto>('/api/queue', input),
    onSuccess: (board) => write(board),
  })
}

export function useQueueAction() {
  const write = useBoardWriter()
  return useMutation({
    mutationFn: ({ id, action, input }: { id: string; action: QueueAction; input?: QueueActionInput }) =>
      api.post<QueueBoardDto>(`/api/queue/${id}/${actionPath(action)}`, input ?? {}),
    onSuccess: (board, v) => write(board, v.action === 'done'),
  })
}

// ---------- Public (customer) side ----------

/** A shop's queue at a glance (no names). Anonymous. */
export function usePublicQueue(slug: string, enabled = true) {
  return useQuery({
    queryKey: ['public-queue', slug],
    queryFn: () => api.get<PublicQueueDto>(`/api/public/profiles/${encodeURIComponent(slug)}/queue`, undefined, { anonymous: true }),
    enabled: enabled && !!slug,
    retry: noRetry4xx,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
}

/** Joining needs the customer's one-time-code session; a 401 is handled on the page. */
export function useJoinQueue(slug: string) {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (input: QueueJoinInput) =>
      api.post<PublicTicketCreatedDto>(`/api/public/profiles/${encodeURIComponent(slug)}/queue`, input, { customer: true, soft401: true }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['public-queue', slug] }),
  })
}

export const TICKET_REFETCH_MS = 15_000

/** A queue ticket: by its private link token, or (without one) as the signed-in customer who joined. */
export function usePublicTicket(id: string, token: string | null, signedIn: boolean) {
  return useQuery({
    queryKey: ['public-ticket', id, token],
    queryFn: () =>
      token
        ? api.get<PublicTicketDto>(`/api/public/queue/${encodeURIComponent(id)}`, { t: token }, { anonymous: true })
        : api.get<PublicTicketDto>(`/api/public/queue/${encodeURIComponent(id)}`, undefined, { customer: true, soft401: true }),
    enabled: !!id && (!!token || signedIn),
    retry: noRetry4xx,
    refetchInterval: (q) => (q.state.data && ['done', 'left', 'no_show'].includes(q.state.data.status) ? false : TICKET_REFETCH_MS),
  })
}

export function useLeaveQueue(id: string) {
  const qc = useQueryClient()
  return useMutation({
    /** Leaving needs the ticket's private link token (the API checks it). */
    mutationFn: (token: string) => api.post<PublicTicketDto>(`/api/public/queue/${encodeURIComponent(id)}/leave`, { token }, { anonymous: true }),
    onSuccess: (t) => qc.setQueriesData({ queryKey: ['public-ticket', id] }, t),
  })
}
