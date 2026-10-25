import { useEffect } from 'react'
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { CalendarCheck, ShieldCheck, Sparkles } from 'lucide-react'
import { Callout } from '@/components/shared/Callout'
import { FullPageLoader } from '@/components/shared/FullPageLoader'
import { Wordmark } from '@/components/shared/Logo'
import { useAuth } from '@/features/auth/AuthProvider'
import { safeNext } from '@/lib/customer'
import { OtpSignIn } from './OtpSignIn'

/** /c/sign-in?next=… — customers verify with a one-time code (email, or SMS when enabled). No password, no profile to fill in. */
export function CustomerSignInPage() {
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'), '/c')
  const { session, loading } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    document.title = 'Customer sign in | KasiFlow SA'
  }, [])

  if (loading) return <FullPageLoader label="Checking your session" />
  // Already signed in (or just came back from the link in the email): carry on.
  if (session) return <Navigate to={next} replace />

  const redirectTo = `${window.location.origin}/c/sign-in?next=${encodeURIComponent(next)}`

  return (
    <div className="min-h-dvh">
      <div className="kasi-band h-2" aria-hidden />
      <main className="mx-auto flex max-w-md flex-col px-4 py-8 sm:py-14">
        <Link to="/" aria-label="KasiFlow SA home" className="self-start">
          <Wordmark />
        </Link>
        <div className="mt-8 rounded-lg border border-line bg-surface p-5 shadow-card sm:p-7">
          <p className="text-sm font-semibold text-ochre">For customers</p>
          <h1 className="mt-1 text-2xl font-bold">Sign in to book</h1>
          <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">
            Verify your email with a one-time code. There is no password and no profile to create. Then you can book, see and change your bookings.
          </p>
          {params.get('expired') && (
            <Callout tone="warning" className="mt-5" title="Your session ended">
              Get a new code to continue.
            </Callout>
          )}
          <div className="mt-6">
            <OtpSignIn redirectTo={redirectTo} onVerified={() => navigate(next, { replace: true })} idPrefix="csi" autoFocus />
          </div>
        </div>
        <ul className="mt-6 space-y-2.5 text-sm text-ink-soft">
          <li className="flex gap-2.5">
            <CalendarCheck className="mt-0.5 size-4 shrink-0 text-forest-800" aria-hidden />
            All your bookings in one place, with any changes the shop proposes.
          </li>
          <li className="flex gap-2.5">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-forest-800" aria-hidden />
            Your details are shared only with the shop you book with.
          </li>
          <li className="flex gap-2.5">
            <Sparkles className="mt-0.5 size-4 shrink-0 text-forest-800" aria-hidden />
            Want a house call? Add your address and contact number once in your account.
          </li>
        </ul>
        <p className="mt-8 text-center text-sm text-ink-soft">
          Barber or shop owner?{' '}
          <Link to="/sign-in" className="font-semibold text-forest-800 hover:underline">
            Sign in to your shop
          </Link>
        </p>
      </main>
    </div>
  )
}
