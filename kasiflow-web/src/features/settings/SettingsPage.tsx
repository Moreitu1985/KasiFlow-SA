import { toast } from 'sonner'
import { LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { RoleHeader } from '@/features/access/RoleHeader'
import { ErrorState } from '@/components/shared/States'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBusiness } from '@/features/business/BusinessProvider'
import { BusinessForm } from '@/features/business/BusinessForm'
import { useUpdateBusiness } from '@/features/business/api'
import { DemoDataCard } from '@/features/business/DemoDataCard'
import { formatDate } from '@/lib/format'
import { CashSettingsForm } from './CashSettingsForm'
import { Link } from 'react-router-dom'
import { BookingPolicyCard, DebtPolicyCard } from './PolicyCards'
import { useSettings, useUpdateSettings } from './api'
import { useAccess } from '@/features/access/useAccess'
import { NotificationPreferences } from '@/features/notifications/NotificationPreferences'
import { roleLabel } from '@/lib/access'

export function SettingsPage() {
  const { user, signOut } = useAuth()
  const { activeBusiness } = useBusiness()
  const { can, role } = useAccess()
  const canManage = can('manageSettings')
  const updateBusiness = useUpdateBusiness()
  // Only roles that can read these settings load them (others would get 403).
  const settings = useSettings(can('viewFinancials', 'manageSettings'))
  const updateSettings = useUpdateSettings()

  return (
    <div className="space-y-6">
      <RoleHeader title="Settings" description="Your business details, cash settings, booking and debt policies, notifications and account." />

      {canManage && (
      <Card>
        <CardHeader>
          <CardTitle>Business profile</CardTitle>
          <CardDescription>Used in your reports and business summary.</CardDescription>
        </CardHeader>
        <CardContent>
          {activeBusiness ? (
            <BusinessForm
              key={activeBusiness.id + activeBusiness.updatedAt}
              initial={activeBusiness}
              submitLabel="Save business profile"
              onSubmit={async (input) => {
                await updateBusiness.mutateAsync({ id: activeBusiness.id, input })
                toast.success('Business profile saved')
              }}
            />
          ) : (
            <Skeleton className="h-64" />
          )}
        </CardContent>
      </Card>
      )}

      {can('viewFinancials', 'manageSettings') && (
      <Card>
        <CardHeader>
          <CardTitle>Cash settings</CardTitle>
          <CardDescription>
            {settings.data?.openingBalanceDate
              ? `Opening balance counted on ${formatDate(settings.data.openingBalanceDate)}.`
              : 'Set your opening cash balance so your balance and forecast start from the right number.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {settings.isLoading ? (
            <Skeleton className="h-40" />
          ) : settings.isError ? (
            <ErrorState error={settings.error} onRetry={() => settings.refetch()} />
          ) : (
            <CashSettingsForm
              key={JSON.stringify(settings.data)}
              initial={settings.data}
              readOnly={!canManage}
              onSubmit={async (input) => {
                // Keep the automation thresholds (variance, reorder, large sale) the form does not edit.
                await updateSettings.mutateAsync({ ...settings.data, ...input })
                toast.success('Cash settings saved')
              }}
            />
          )}
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Notifications</CardTitle>
          <CardDescription>What appears under the bell, and when your daily briefing is prepared. These settings are yours only.</CardDescription>
        </CardHeader>
        <CardContent>
          <NotificationPreferences />
        </CardContent>
      </Card>

      {can('manageSettings', 'manageBookings') && <BookingPolicyCard />}

      {can('viewFinancials', 'recordDebtPayments', 'configureDebtPolicy') && <DebtPolicyCard />}

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Public business profile & booking link</CardTitle>
            <CardDescription>Your public page, online booking link and QR code now live under Business Profile.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to="/business-profile">Open Business Profile</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <DemoDataCard compact />

      <Card>
        <CardHeader>
          <CardTitle>Account</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[13px] text-ink-muted">Signed in as</p>
            <p className="font-medium">{user?.email}</p>
            {role && <p className="text-[13px] text-ink-muted">Your role in {activeBusiness?.name}: {roleLabel(role)}</p>}
            <p className="mt-1 text-[13px] text-ink-muted">To change your password, sign out and use “Forgot password” on the sign-in page.</p>
          </div>
          <Button variant="outline" onClick={() => void signOut()}>
            <LogOut /> Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
