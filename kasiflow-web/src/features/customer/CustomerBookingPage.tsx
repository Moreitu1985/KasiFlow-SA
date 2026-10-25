import { useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowLeft, SearchX } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState, ErrorState } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { BookingStatusView, type StatusAct } from '@/features/public-booking/BookingStatusView'
import { useCustomerBooking, useCustomerBookingAction, useCustomerBookings } from './api'

/** /c/bookings/:reference — one of the customer's bookings, with the same actions as the secret-link status page. */
export function CustomerBookingPage() {
  const { reference = '' } = useParams()
  const q = useCustomerBooking(reference)
  const list = useCustomerBookings()
  const act = useCustomerBookingAction(reference)
  const slug = list.data?.find((x) => x.reference === reference)?.slug ?? null
  const b = q.data

  useEffect(() => {
    document.title = b ? `Booking ${b.reference} | ${b.businessName}` : 'My booking | KasiFlow SA'
  }, [b])

  const run: StatusAct = async (op, input, ok) => {
    try {
      await act.mutateAsync({ op, input })
      toast.success(ok)
      return true
    } catch (e) {
      toast.error('Could not update your booking', { description: errorMessage(e) })
      return false
    }
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link to="/c" className="mb-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-forest-800 hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> My bookings
      </Link>
      {q.isLoading ? (
        <Skeleton className="h-64" />
      ) : q.error instanceof ApiError && q.error.status === 404 ? (
        <EmptyState icon={SearchX} title="Booking not found" description="It may have been made with a different email or phone number." />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load your booking" />
      ) : b ? (
        <BookingStatusView booking={b} slug={slug} act={run} pendingOp={act.isPending ? (act.variables?.op ?? null) : null} />
      ) : null}
    </div>
  )
}
