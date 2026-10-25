import { useState } from 'react'
import { Link, Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Wordmark } from '@/components/shared/Logo'
import { FullPageLoader } from '@/components/shared/FullPageLoader'
import { ErrorState } from '@/components/shared/States'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBusiness } from './BusinessProvider'
import { useCreateBusiness } from './api'
import { BusinessForm } from './BusinessForm'
import { DemoDataCard } from './DemoDataCard'
import { CashSettingsForm } from '@/features/settings/CashSettingsForm'
import { useUpdateSettings } from '@/features/settings/api'
import { cn } from '@/lib/utils'

export function OnboardingPage() {
  const { user, signOut } = useAuth()
  const { me, setActiveBusiness } = useBusiness()
  const navigate = useNavigate()
  const create = useCreateBusiness()
  const updateSettings = useUpdateSettings()
  const [step, setStep] = useState<1 | 2>(1)

  if (me.isLoading) return <FullPageLoader label="Loading your account" />
  if (me.isError)
    return (
      <div className="mx-auto max-w-lg p-6">
        <ErrorState error={me.error} onRetry={() => me.refetch()} title="Could not load your account" />
      </div>
    )
  if (step === 1 && me.data && me.data.businesses.length > 0) return <Navigate to="/app" replace />

  return (
    <div className="min-h-dvh">
      <header className="kasi-band h-2" aria-hidden />
      <div className="mx-auto max-w-2xl px-4 py-8 sm:py-12">
        <div className="flex items-center justify-between">
          <Wordmark />
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>

        <ol className="mt-10 flex gap-3 text-sm" aria-label="Setup steps">
          {['Business profile', 'Starting cash'].map((label, i) => {
            const n = i + 1
            const active = step === n
            const done = step > n
            return (
              <li key={label} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-full border text-[13px] font-semibold',
                    active && 'border-primary bg-primary text-primary-fg',
                    done && 'border-emerald-brand bg-emerald-brand text-forest-950',
                    !active && !done && 'border-line-strong text-ink-muted',
                  )}
                >
                  {n}
                </span>
                <span className={cn('font-medium', active ? 'text-ink' : 'text-ink-muted')}>{label}</span>
                {n === 1 && <span className="ml-1 h-px w-8 bg-line-strong" aria-hidden />}
              </li>
            )
          })}
        </ol>

        {step === 1 && (
          <p className="mt-6 rounded-lg border border-forest-800/20 bg-forest-50 px-4 py-3 text-sm text-ink">
            Just here to book a haircut?{' '}
            <Link to="/c" className="font-semibold text-forest-800 underline-offset-2 hover:underline">
              Go to My bookings
            </Link>
            . Barber with an invite link? Open the link from your shop to join it.
          </p>
        )}

        {step === 1 && (
          <div className="mt-6">
            <DemoDataCard />
          </div>
        )}

        {step === 1 ? (
          <section className="mt-6 rounded-lg border border-line bg-surface p-5 shadow-card sm:p-8">
            <h1 className="text-2xl font-bold">Tell us about your business</h1>
            <p className="mt-1 text-[15px] text-ink-soft">This sets up your cash book. Only you can see these details.</p>
            <div className="mt-6">
              <BusinessForm
                defaultEmail={user?.email ?? ''}
                submitLabel="Create business"
                onSubmit={async (input) => {
                  const biz = await create.mutateAsync(input)
                  setActiveBusiness(biz.id)
                  toast.success('Business created')
                  setStep(2)
                }}
              />
            </div>
          </section>
        ) : (
          <section className="mt-6 rounded-lg border border-line bg-surface p-5 shadow-card sm:p-8">
            <h1 className="text-2xl font-bold">How much cash do you have right now?</h1>
            <p className="mt-1 text-[15px] leading-relaxed text-ink-soft">
              Count the cash in the till and check the business bank balance. KasiFlow starts your cash balance and forecast
              from this number. You can skip this and add it later in Settings.
            </p>
            <div className="mt-6">
              <CashSettingsForm
                showForecastDays={false}
                submitLabel="Save and continue"
                onSubmit={async (input) => {
                  await updateSettings.mutateAsync(input)
                  toast.success('Cash settings saved')
                  navigate('/app', { replace: true })
                }}
                secondary={
                  <Button type="button" variant="outline" size="lg" onClick={() => navigate('/app', { replace: true })}>
                    Skip for now
                  </Button>
                }
              />
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

