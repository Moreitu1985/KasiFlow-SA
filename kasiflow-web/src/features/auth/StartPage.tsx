import { Navigate } from 'react-router-dom'
import { useAccess } from '@/features/access/useAccess'

/**
 * /start — where to land after signing in. Each role lands on its own home (from its experience).
 * Wrapped in RequireBusiness, so people without a business (e.g. customers) go to onboarding, which links to My bookings.
 */
export function StartPage() {
  const { experience } = useAccess()
  return <Navigate to={experience.homePath} replace />
}
