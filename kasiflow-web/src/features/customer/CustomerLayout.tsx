import type { ReactNode } from 'react'
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom'
import { Building2, LogIn, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LogoMark, Wordmark } from '@/components/shared/Logo'
import { FullPageLoader } from '@/components/shared/FullPageLoader'
import { ShellBottomTabs, ShellTopNav } from '@/layouts/shell'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBusiness } from '@/features/business/BusinessProvider'
import { useCustomerExperience } from './useCustomerExperience'
import { ThemeMenuButton } from '@/features/theme/ThemeToggle'

/** Customer pages need a signed-in person (one-time code) but never a business membership. */
export function RequireCustomer({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoader label="Checking your session" />
  if (!session) return <Navigate to={`/c/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />
  return <>{children}</>
}

/**
 * The customer app's frame: logo, the experience's screens (top links on wide screens, bottom tabs on phones) and
 * sign in / sign out. "Find a barber" works signed out; the other screens sit behind RequireCustomer.
 */
export function CustomerLayout() {
  const { signOut } = useAuth()
  const { businesses } = useBusiness()
  const { experience, signedIn } = useCustomerExperience()
  const location = useLocation()
  const tabs = signedIn && experience.tabs.length > 1
  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
        Skip to content
      </a>
      <div className="kasi-band h-2" aria-hidden />
      <header className="sticky top-0 z-20 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-2 px-4">
          <Link to={signedIn ? experience.homePath : '/'} aria-label="KasiFlow SA home" className="mr-auto shrink-0">
            <LogoMark className="size-9 text-forest-900 dark:text-[#2a2a2f] sm:hidden" />
            <Wordmark className="hidden sm:inline-flex" />
          </Link>
          <ShellTopNav experience={experience} className={signedIn ? 'hidden md:block' : 'hidden'} />
          <ThemeMenuButton />
          {signedIn ? (
            <Button variant="ghost" onClick={() => void signOut()} className="shrink-0">
              <LogOut aria-hidden />
              Sign out
            </Button>
          ) : (
            <Button asChild className="shrink-0">
              <Link to={`/c/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`}>
                <LogIn aria-hidden /> Sign in
              </Link>
            </Button>
          )}
        </div>
      </header>
      <main id="main" className={tabs ? 'mx-auto w-full max-w-5xl flex-1 px-4 pt-6 pb-28 sm:pt-8 md:pb-10' : 'mx-auto w-full max-w-5xl flex-1 px-4 py-6 sm:py-8'}>
        <div key={location.pathname} className="animate-page-in">
          <Outlet />
        </div>
      </main>
      <footer className={tabs ? 'border-t border-line bg-surface pb-20 md:pb-0' : 'border-t border-line bg-surface'}>
        <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-5 text-[13px] text-ink-muted sm:flex-row sm:items-center sm:justify-between">
          <p>Bookings are managed by each business. KasiFlow SA does not take payments for bookings.</p>
          {businesses.length > 0 && (
            <Link to="/start" className="inline-flex min-h-11 items-center gap-1.5 font-semibold text-forest-800 hover:underline">
              <Building2 className="size-4" aria-hidden /> Open my business
            </Link>
          )}
        </div>
      </footer>
      {tabs && <ShellBottomTabs experience={experience} className="md:hidden" />}
    </div>
  )
}
