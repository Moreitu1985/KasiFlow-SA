import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, CalendarCheck, Search } from 'lucide-react'
import { LogoMark, Wordmark } from '@/components/shared/Logo'
import { useAuth } from '@/features/auth/AuthProvider'
import { cn } from '@/lib/utils'
import { ThemeMenuButton } from '@/features/theme/ThemeToggle'

/**
 * Frame for the public shop pages (booking and booking status): the customer app's header (Find a barber, My
 * bookings) without its sign-in requirement, so the pages feel like part of the customer app.
 */
export function PublicShell({
  children,
  back,
  wide,
  actions,
  className,
}: {
  children: ReactNode
  back?: { to: string; label: string }
  wide?: boolean
  actions?: ReactNode
  className?: string
}) {
  const { session } = useAuth()
  const link = 'inline-flex h-11 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-ink-soft hover:bg-forest-50 hover:text-ink'
  return (
    <div className="min-h-dvh">
      <div className="kasi-band h-2" aria-hidden />
      <header className="border-b border-line bg-surface/95">
        <div className={cn('mx-auto flex h-16 items-center gap-1 px-4', wide ? 'max-w-6xl' : 'max-w-2xl')}>
          <Link to="/c/shops" aria-label="KasiFlow SA, find a barber" className="mr-auto shrink-0">
            <LogoMark className="size-9 text-forest-900 dark:text-[#2a2a2f] sm:hidden" />
            <Wordmark className="hidden sm:inline-flex" />
          </Link>
          <Link to="/c/shops" className={link}>
            <Search className="size-4" aria-hidden /> <span className="max-[379px]:sr-only">Find a barber</span>
          </Link>
          {session && (
            <Link to="/c" className={link}>
              <CalendarCheck className="size-4" aria-hidden /> <span className="max-[379px]:sr-only">My bookings</span>
            </Link>
          )}
          <ThemeMenuButton />
        </div>
      </header>
      <main className={cn('animate-page-in mx-auto px-4 py-6 sm:py-8', wide ? 'max-w-6xl' : 'max-w-2xl', className)}>
        {(back || actions) && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            {back ? (
              <Link to={back.to} className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-forest-800 hover:underline">
                <ArrowLeft className="size-4" aria-hidden /> {back.label}
              </Link>
            ) : (
              <span />
            )}
            {actions}
          </div>
        )}
        {children}
        <footer className="mt-12 flex flex-col items-center gap-2 text-center text-[13px] text-ink-muted">
          <Link to="/" aria-label="KasiFlow SA home" className="opacity-80 hover:opacity-100">
            <Wordmark className="[&_svg]:size-6 [&_span]:text-base" />
          </Link>
          <p>Bookings are managed by the business. KasiFlow SA does not take payments for bookings.</p>
        </footer>
      </main>
    </div>
  )
}
