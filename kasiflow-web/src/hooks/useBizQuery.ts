import { useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useBusiness } from '@/features/business/BusinessProvider'

export type Domain =
  | 'dashboard'
  | 'transactions'
  | 'categories'
  | 'customers'
  | 'receivables'
  | 'suppliers'
  | 'payables'
  | 'growth'
  | 'forecast'
  | 'opportunities'
  | 'registration'
  | 'funding'
  | 'publicProfile'
  | 'settings'
  | 'fraud'
  | 'reports'
  | 'integrations'
  | 'reconciliation'
  | 'notifications'
  | 'briefing'
  | 'staff'
  | 'branches'
  | 'shifts'
  | 'inventory'
  | 'workspace'
  | 'team'
  | 'services'
  | 'bookings'
  | 'houseCalls'
  | 'policies'
  | 'debts'
  | 'money'
  | 'alerts'
  | 'proofs'
  | 'bankDetails'
  | 'queue'
  | 'pay'
  | 'insights'

/** Domains affected by any change to money records. */
export const MONEY_DOMAINS: Domain[] = [
  'dashboard',
  'transactions',
  'receivables',
  'customers',
  'payables',
  'suppliers',
  'growth',
  'forecast',
  'reports',
  'funding',
  'reconciliation',
  'briefing',
  'shifts',
  'inventory',
  'debts',
  'money',
  'proofs',
  'alerts',
  'bookings',
  'houseCalls',
  'queue',
  'pay',
  'insights',
]

/** Polling interval for data that background workers change (webhooks, jobs). TanStack pauses it while the tab is hidden. */
export const LIVE_REFETCH_MS = 15_000

/** Build query keys scoped to the active business: ['biz', id, domain, ...rest]. */
export function useBizKey() {
  const { activeBusinessId } = useBusiness()
  return useCallback(
    (domain: Domain, ...rest: unknown[]) => ['biz', activeBusinessId, domain, ...rest] as const,
    [activeBusinessId],
  )
}

export function useInvalidate() {
  const qc = useQueryClient()
  const { activeBusinessId } = useBusiness()
  return useCallback(
    (domains: Domain[]) =>
      Promise.all(domains.map((d) => qc.invalidateQueries({ queryKey: ['biz', activeBusinessId, d] }))),
    [qc, activeBusinessId],
  )
}

export function useBizReady(): boolean {
  return !!useBusiness().activeBusinessId
}
