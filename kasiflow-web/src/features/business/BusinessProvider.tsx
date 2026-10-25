import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { api } from '@/lib/apiClient'
import { getActiveBusinessId, setActiveBusinessId } from '@/lib/activeBusiness'
import { useAuth } from '@/features/auth/AuthProvider'
import type { BusinessDto, MeDto } from '@/types/api'

interface BusinessState {
  me: UseQueryResult<MeDto>
  businesses: BusinessDto[]
  activeBusiness: BusinessDto | null
  activeBusinessId: string | null
  setActiveBusiness: (id: string) => void
}

const BusinessContext = createContext<BusinessState | null>(null)

export const ME_KEY = ['me'] as const

export function BusinessProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth()
  const userId = session?.user.id ?? null
  const me = useQuery({
    queryKey: [...ME_KEY, userId],
    queryFn: () => api.get<MeDto>('/api/me'),
    enabled: !!userId,
    staleTime: 5 * 60_000,
  })
  const [activeId, setActiveId] = useState<string | null>(getActiveBusinessId())

  const businesses = useMemo(() => me.data?.businesses ?? [], [me.data])

  useEffect(() => {
    if (!me.data) return
    const list = me.data.businesses
    // Nothing to choose yet (e.g. just created the first business and /api/me is refetching).
    if (list.length === 0) return
    const current = list.find((b) => b.id === activeId)
    // Fall back to the oldest business (matches the API default when X-Business-Id is omitted).
    const next = current?.id ?? [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0]?.id ?? null
    if (next !== activeId) {
      setActiveBusinessId(next)
      setActiveId(next)
    }
  }, [me.data, activeId])

  const setActiveBusiness = useCallback((id: string) => {
    setActiveBusinessId(id)
    setActiveId(id)
  }, [])

  const value = useMemo<BusinessState>(
    () => ({
      me,
      businesses,
      activeBusiness: businesses.find((b) => b.id === activeId) ?? null,
      activeBusinessId: activeId,
      setActiveBusiness,
    }),
    [me, businesses, activeId, setActiveBusiness],
  )
  return <BusinessContext.Provider value={value}>{children}</BusinessContext.Provider>
}

export function useBusiness(): BusinessState {
  const ctx = useContext(BusinessContext)
  if (!ctx) throw new Error('useBusiness must be used inside BusinessProvider')
  return ctx
}
