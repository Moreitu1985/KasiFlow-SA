import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ArrowRight, BadgeCheck, LogOut, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Callout } from '@/components/shared/Callout'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ErrorState } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDate } from '@/lib/format'
import { safeNext } from '@/lib/customer'
import { useAuth } from '@/features/auth/AuthProvider'
import { AccountDetailsForm, HouseCallReadiness } from './AccountForm'
import { CustomerHeader } from './CustomerHeader'
import { useCustomerAccount, useDeleteCustomerAccount } from './api'

/** /c/account — saved details for house calls, the verified contact, delete my details, sign out. */
export function CustomerAccountPage() {
  const [params] = useSearchParams()
  const next = params.get('next') ? safeNext(params.get('next'), '/c') : null
  const { signOut } = useAuth()
  const q = useCustomerAccount()
  const del = useDeleteCustomerAccount()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const a = q.data

  useEffect(() => {
    document.title = 'My account | KasiFlow SA'
  }, [])

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <CustomerHeader
        title="My account"
        description="Your details are saved once and used when you book. Shops only see them for bookings you make with them."
       
      />

      {next && (
        <Callout
          tone={a?.houseCallReady ? 'info' : 'warning'}
          title={a?.houseCallReady ? 'You are ready for house calls' : 'Finish your details for the house call'}
          action={
            <Button asChild size="sm">
              <Link to={next}>
                Back to my booking <ArrowRight />
              </Link>
            </Button>
          }
        >
          {a?.houseCallReady ? 'Go back to your booking to send the request.' : 'Fill in what is still needed below and save, then go back to your booking.'}
        </Callout>
      )}

      {q.isLoading ? (
        <Skeleton className="h-96" />
      ) : q.error instanceof ApiError && q.error.status === 403 ? (
        <Callout tone="warning" title="This login has no verified email or phone">
          Customer accounts are for people who signed in with a one-time code. {q.error.userMessage}
          <div className="mt-3">
            <Button size="sm" variant="outline" onClick={() => void signOut()}>
              <LogOut /> Sign out
            </Button>
          </div>
        </Callout>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load your account" />
      ) : a ? (
        <>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="text-[13px] text-ink-muted">Signed in as</p>
                <p className="flex items-center gap-1.5 font-semibold [overflow-wrap:anywhere]">
                  <BadgeCheck className="size-4 shrink-0 text-emerald-700" aria-hidden />
                  {a.verifiedContact}
                </p>
                <p className="text-[13px] text-ink-muted">
                  Verified {a.verifiedChannel === 'email' ? 'email' : 'phone'} · customer since {formatDate(a.memberSince)}
                </p>
              </div>
              <p className="text-[12px] text-ink-muted sm:max-w-56 sm:text-right">To use a different email, sign out and sign in again with the new one.</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">My details</CardTitle>
              <CardDescription>Needed for house calls, so the barber knows who to expect and where. Optional for visits at the shop.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <HouseCallReadiness account={a} />
              <AccountDetailsForm key={a.memberSince + (a.fullName ?? '') + a.houseCallTermsAccepted} account={a} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Privacy</CardTitle>
              <CardDescription>
                Deleting removes your saved name, phone number and address. Bookings you already made keep the details you gave for them, so the shop can
                still honour them.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 sm:flex-row">
              <Button variant="outline" className="text-red-700 hover:text-red-800" onClick={() => setConfirmDelete(true)}>
                <Trash2 /> Delete my saved details
              </Button>
              <Button variant="ghost" onClick={() => void signOut()}>
                <LogOut /> Sign out
              </Button>
            </CardContent>
          </Card>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete your saved details?"
        description="Your name, phone number, address and agreement to the house-call terms are removed. You stay signed in and can still book at the shop."
        confirmLabel="Delete my details"
        destructive
        pending={del.isPending}
        onConfirm={() =>
          del.mutate(undefined, {
            onSuccess: () => {
              toast.success('Your saved details were deleted')
              setConfirmDelete(false)
            },
            onError: (e) => toast.error('Could not delete your details', { description: errorMessage(e) }),
          })
        }
      />
    </div>
  )
}
