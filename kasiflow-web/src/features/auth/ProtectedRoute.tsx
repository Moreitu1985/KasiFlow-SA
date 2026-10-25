import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { FullPageLoader } from '@/components/shared/FullPageLoader'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoader label="Checking your session" />
  if (!session) {
    const next = encodeURIComponent(location.pathname + location.search)
    return <Navigate to={`/sign-in?next=${next}`} replace />
  }
  return <>{children}</>
}

/** For sign-in/up pages: signed-in users go straight to the app. */
export function GuestOnly({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <FullPageLoader label="Checking your session" />
  // /start picks the right home (barbers: workspace; owners: overview; no business yet: onboarding).
  if (session) return <Navigate to="/start" replace />
  return <>{children}</>
}
