import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, LogOut, MailWarning, TriangleAlert } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Wordmark } from '@/components/shared/Logo'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { useAuth } from '@/features/auth/AuthProvider'
import { ME_KEY, useBusiness } from '@/features/business/BusinessProvider'
import { experienceFor } from '@/features/access/useAccess'
import type { BusinessSummaryForJoinDto } from '@/types/automation'
import { useAcceptInvitation } from './api'

type State =
  | { kind: 'working' }
  | { kind: 'joined'; result: BusinessSummaryForJoinDto }
  | { kind: 'wrong_email'; message: string }
  | { kind: 'invalid'; message: string }
  | { kind: 'already'; message: string }
  | { kind: 'error'; message: string }

/** /join?token=… — accepts an invitation for the signed-in person, then switches to the joined business. */
export function JoinPage() {
  const [params] = useSearchParams()
  const token = params.get('token')?.trim() ?? ''
  const { user, signOut } = useAuth()
  const { setActiveBusiness, businesses } = useBusiness()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const accept = useAcceptInvitation()
  const [state, setState] = useState<State>(token ? { kind: 'working' } : { kind: 'invalid', message: 'This invitation link is incomplete. Ask for a new link.' })
  const started = useRef(false)

  const { mutate } = accept
  const run = useCallback(() => {
    setState({ kind: 'working' })
    mutate(token, {
      onSuccess: async (result) => {
        await qc.refetchQueries({ queryKey: ME_KEY })
        setActiveBusiness(result.businessId)
        setState({ kind: 'joined', result })
      },
      onError: (err) => {
        const message = errorMessage(err)
        if (err instanceof ApiError && err.status === 403) setState({ kind: 'wrong_email', message })
        else if (err instanceof ApiError && err.status === 400) setState({ kind: 'invalid', message })
        else if (err instanceof ApiError && err.status === 409) setState({ kind: 'already', message })
        else setState({ kind: 'error', message })
      },
    })
  }, [mutate, token, qc, setActiveBusiness])

  // Where the new member lands comes from the app their role has in the joined business.
  const joined = state.kind === 'joined' ? businesses.find((b) => b.id === state.result.businessId) : undefined
  const joinedApp = joined ? experienceFor(joined) : null

  useEffect(() => {
    // Accept once (guards against React StrictMode running effects twice: a token works only once).
    if (!token || started.current) return
    started.current = true
    run()
  }, [token, run])

  const signOutAndRetry = async () => {
    await signOut()
    navigate(`/sign-in?next=${encodeURIComponent(`/join?token=${token}`)}`, { replace: true })
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-lg flex-col justify-center px-4 py-10">
      <Wordmark />
      <div className="mt-8 rounded-lg border border-line bg-surface p-6 shadow-card" aria-live="polite">
        {state.kind === 'working' && (
          <div className="flex items-center gap-3">
            <Loader2 className="size-5 animate-spin text-forest-800" aria-hidden />
            <p>Joining the business…</p>
          </div>
        )}
        {state.kind === 'joined' && (
          <>
            <CheckCircle2 className="size-8 text-emerald-700" aria-hidden />
            <h1 className="mt-3 text-2xl font-bold">Welcome to {state.result.businessName}</h1>
            <p className="mt-2 text-ink-soft">
              You joined as <strong>{state.result.roleLabel}</strong>. You can switch between businesses from the menu.
            </p>
            {joinedApp?.purpose && <p className="mt-2 text-ink-soft">{joinedApp.purpose}</p>}
            <Button size="lg" className="mt-5" onClick={() => navigate(joinedApp?.homePath ?? '/start', { replace: true })}>
              Open my {joinedApp?.title ?? 'app'}
            </Button>
          </>
        )}
        {state.kind === 'wrong_email' && (
          <>
            <MailWarning className="size-8 text-amber-700" aria-hidden />
            <h1 className="mt-3 text-2xl font-bold">This invitation is for a different email</h1>
            <p className="mt-2 text-ink-soft">{state.message}</p>
            <p className="mt-2 text-sm text-ink-muted">You are signed in as {user?.email ?? 'another account'}.</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button onClick={() => void signOutAndRetry()}>
                <LogOut /> Sign in with the invited email
              </Button>
              <Button asChild variant="outline">
                <Link to="/start">Go to my account</Link>
              </Button>
            </div>
          </>
        )}
        {(state.kind === 'invalid' || state.kind === 'already' || state.kind === 'error') && (
          <>
            <TriangleAlert className="size-8 text-amber-700" aria-hidden />
            <h1 className="mt-3 text-2xl font-bold">
              {state.kind === 'invalid' ? 'This link does not work' : state.kind === 'already' ? 'Nothing to join' : 'Something went wrong'}
            </h1>
            <p className="mt-2 text-ink-soft">{state.message}</p>
            {state.kind === 'invalid' && <p className="mt-2 text-sm text-ink-muted">Invitation links expire and work only once. Ask the business owner for a new one.</p>}
            <div className="mt-5 flex flex-wrap gap-2">
              {state.kind === 'error' && (
                <Button onClick={run}>
                  Try again
                </Button>
              )}
              <Button asChild variant="outline">
                <Link to="/start">Go to my account</Link>
              </Button>
            </div>
          </>
        )}
      </div>
    </main>
  )
}
