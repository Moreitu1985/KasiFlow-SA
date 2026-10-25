import { useEffect } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { SearchX } from 'lucide-react'
import { toast } from 'sonner'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { PublicShell } from './PublicShell'
import { BookingStatusView, type StatusAct } from './BookingStatusView'
import { usePublicBookingAction, usePublicBookingStatus } from './api'

/** /p/:slug/booking/:reference?t=… — the secret-link status page (works without signing in). */
export function PublicBookingStatusPage() {
  const { slug = '', reference = '' } = useParams()
  const [params] = useSearchParams()
  const token = params.get('t') ?? ''
  const q = usePublicBookingStatus(reference, token)
  const act = usePublicBookingAction(reference)
  const b = q.data

  useEffect(() => {
    document.title = b ? `Booking ${b.reference} | ${b.businessName}` : 'Your booking | KasiFlow SA'
  }, [b])

  const run: StatusAct = async (op, input, ok) => {
    try {
      await act.mutateAsync({ op, input: { token, ...input } })
      toast.success(ok)
      void q.refetch()
      return true
    } catch (e) {
      toast.error('Could not update your booking', { description: errorMessage(e) })
      return false
    }
  }

  const notFound = !token || (q.error instanceof ApiError && q.error.status === 404)

  return (
    <PublicShell back={{ to: `/p/${slug}`, label: 'Business profile' }}>
      {notFound ? (
        <div className="rounded-lg border border-line bg-surface px-6 py-14 text-center shadow-card">
          <SearchX className="mx-auto mb-4 size-10 text-forest-800" aria-hidden />
          <h1 className="text-2xl font-bold">Booking not found</h1>
          <p className="mx-auto mt-2 max-w-sm text-[15px] text-ink-soft">Check that you opened the full link you were given when you booked. The link includes a secret code.</p>
          <p className="mx-auto mt-4 max-w-sm text-sm text-ink-soft">
            Booked with your email?{' '}
            <Link to="/c" className="font-semibold text-forest-800 hover:underline">
              See My bookings
            </Link>
          </p>
        </div>
      ) : q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load your booking" />
      ) : b ? (
        <BookingStatusView
          booking={b}
          slug={slug}
          act={run}
          pendingOp={act.isPending ? (act.variables?.op ?? null) : null}
          footer={
            <p className="text-center text-[13px] text-ink-muted">
              Keep this page’s link private — anyone with it can change this booking. Signed in with your email? Your bookings are also in{' '}
              <Link to="/c" className="font-semibold text-forest-800 hover:underline">
                My bookings
              </Link>
              .
            </p>
          }
        />
      ) : null}
    </PublicShell>
  )
}
