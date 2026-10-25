import { Link, Outlet } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Wordmark } from '@/components/shared/Logo'
import { useAuth } from '@/features/auth/AuthProvider'
import { useBusiness } from '@/features/business/BusinessProvider'
import { ThemeMenuButton } from '@/features/theme/ThemeToggle'

export function PublicLayout() {
  const { session } = useAuth()
  const { businesses } = useBusiness()
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Link to="/" aria-label="KasiFlow SA home">
            <Wordmark />
          </Link>
          <nav className="ml-auto flex items-center gap-1 sm:gap-2" aria-label="Account">
            <Button asChild variant="ghost" className="max-sm:hidden">
              <Link to="/c/shops">Find a barber</Link>
            </Button>
            <ThemeMenuButton />
            {session ? (
              businesses.length > 0 ? (
                <Button asChild>
                  <Link to="/start">Open my shop</Link>
                </Button>
              ) : (
                <Button asChild>
                  <Link to="/c">My bookings</Link>
                </Button>
              )
            ) : (
              <>
                <Button asChild variant="ghost">
                  <Link to="/sign-in">Sign in</Link>
                </Button>
                <Button asChild className="max-sm:hidden">
                  <Link to="/sign-up">Set up a shop</Link>
                </Button>
              </>
            )}
          </nav>
        </div>
      </header>
      <div className="flex-1">
        <Outlet />
      </div>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-sm text-ink-muted sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <Wordmark className="[&_svg]:size-6 [&_span]:text-base" />
          <p className="max-w-xl">
            KasiFlow SA is a record-keeping and planning tool. It is not a bank, does not move money and does not give financial advice.
          </p>
        </div>
      </footer>
    </div>
  )
}
