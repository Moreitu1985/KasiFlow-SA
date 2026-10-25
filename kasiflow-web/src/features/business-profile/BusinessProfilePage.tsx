import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { RoleHeader } from '@/features/access/RoleHeader'
import { ErrorState } from '@/components/shared/States'
import { useBusiness } from '@/features/business/BusinessProvider'
import { PublicProfileForm } from '@/features/settings/PublicProfileForm'
import { usePublicProfileSettings } from '@/features/settings/api'
import { QrCodeCard } from './QrCodeCard'

export function BusinessProfilePage() {
  const { activeBusiness } = useBusiness()
  const profile = usePublicProfileSettings()
  const p = profile.data
  return (
    <div className="space-y-6">
      <RoleHeader
        title="Business profile"
        description="Your public page, online booking link and QR code. Financial records, staff details and customers are never shown publicly."
       
      />
      {profile.isLoading || !activeBusiness ? (
        <Skeleton className="h-64" />
      ) : profile.isError ? (
        <ErrorState error={profile.error} onRetry={() => profile.refetch()} />
      ) : p ? (
        <>
          {p.exists && p.slug && <QrCodeCard slug={p.slug} businessName={activeBusiness.name} published={p.isPublished} />}
          <Card>
            <CardHeader>
              <CardTitle>Public profile</CardTitle>
              <CardDescription>A simple page you can share on WhatsApp or social media.</CardDescription>
            </CardHeader>
            <CardContent>
              <PublicProfileForm profile={p} business={activeBusiness} />
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  )
}
