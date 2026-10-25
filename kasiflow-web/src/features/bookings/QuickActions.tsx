import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { errorMessage } from '@/lib/apiClient'
import { quickActions } from '@/lib/barbershop'
import type { BookingAction, BookingSummaryDto } from '@/types/barbershop'
import { useAccess } from '@/features/access/useAccess'
import { useBookingAction } from './api'

const LABEL: Partial<Record<BookingAction, string>> = {
  confirm: 'Confirm',
  propose_reschedule: 'New time',
  complete: 'Complete',
  no_show: 'No-show',
  accept_proposal: 'Accept',
  reject_proposal: 'Reject',
}

/**
 * Thumb-sized actions on a booking row. Simple ones run here; ones that need a form (complete, propose) open the
 * booking page with that dialog. The API re-checks every action and its refusal message is shown as is.
 */
export function BookingQuickActions({ b }: { b: BookingSummaryDto }) {
  const navigate = useNavigate()
  const act = useBookingAction()
  const [noShow, setNoShow] = useState(false)
  const { can } = useAccess()
  const actions = can('manageBookings', 'workOwnBookings') ? quickActions(b, Date.now()) : []
  if (actions.length === 0) return null

  const run = (a: BookingAction) => {
    if (a === 'complete') return navigate(`/bookings/${b.id}?action=complete`)
    if (a === 'propose_reschedule') return navigate(`/bookings/${b.id}?action=propose`)
    if (a === 'no_show') return setNoShow(true)
    if (a === 'confirm')
      return act.mutate(
        { id: b.id, m: { kind: 'confirm', input: {} } },
        {
          onSuccess: () => toast.success(`${b.reference} confirmed`),
          onError: (e) =>
            toast.error('Could not confirm', { description: errorMessage(e), action: { label: 'Open', onClick: () => navigate(`/bookings/${b.id}?action=confirm`) } }),
        },
      )
    const kind = a === 'accept_proposal' ? 'accept-proposal' : 'reject-proposal'
    act.mutate(
      { id: b.id, m: { kind } },
      { onSuccess: () => toast.success(a === 'accept_proposal' ? 'New time accepted' : 'Proposal rejected'), onError: (e) => toast.error('Could not update', { description: errorMessage(e) }) },
    )
  }

  return (
    <>
      {actions.map((a, i) => (
        <Button
          key={a}
          size="sm"
          className="h-10 min-w-20 px-4"
          variant={i === 0 ? (a === 'complete' ? 'accent' : 'default') : 'outline'}
          loading={act.isPending && i === 0 && (a === 'confirm' || a === 'accept_proposal')}
          onClick={() => run(a)}
        >
          {LABEL[a]}
        </Button>
      ))}
      <ConfirmDialog
        open={noShow}
        onOpenChange={setNoShow}
        title={`Mark ${b.customerName} as a no-show?`}
        description="Use this only if the customer did not arrive. It cannot be undone."
        confirmLabel="Mark as no-show"
        destructive
        pending={act.isPending}
        onConfirm={() =>
          act.mutate(
            { id: b.id, m: { kind: 'no-show' } },
            {
              onSuccess: () => {
                toast.success('Marked as no-show')
                setNoShow(false)
              },
              onError: (e) => toast.error('Could not update', { description: errorMessage(e) }),
            },
          )
        }
      />
    </>
  )
}
