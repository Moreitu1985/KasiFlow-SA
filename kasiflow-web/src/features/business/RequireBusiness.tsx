import { Navigate } from 'react-router-dom'
import { FullPageLoader } from '@/components/shared/FullPageLoader'
import { ErrorState } from '@/components/shared/States'
import { useBusiness } from './BusinessProvider'

/** Gate for app routes: send users without a business to onboarding. */
export function RequireBusiness({ children }: { children: React.ReactNode }) {
  const { me, activeBusinessId } = useBusiness()
  if (me.isLoading) return <FullPageLoader label="Loading your business" />
  if (me.isError)
    return (
      <div className="mx-auto max-w-lg p-6 pt-20">
        <ErrorState error={me.error} onRetry={() => me.refetch()} title="Could not load your account" />
      </div>
    )
  if (me.data && me.data.businesses.length === 0) return <Navigate to="/onboarding" replace />
  if (!activeBusinessId) return <FullPageLoader label="Loading your business" />
  return <>{children}</>
}
