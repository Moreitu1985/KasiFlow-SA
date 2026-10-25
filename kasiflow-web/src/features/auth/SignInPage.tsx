import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ChevronRight, Link2, Scissors, Store, UserRound, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Callout } from '@/components/shared/Callout'
import { requireSupabase } from '@/lib/supabase'
import { inviteTokenFrom } from '@/lib/customer'

const schema = z.object({
  email: z.string().trim().min(1, 'Email is required.').pipe(z.email('Enter a valid email address.')),
  password: z.string().min(1, 'Password is required.'),
})
type Values = z.infer<typeof schema>

type As = 'barber' | 'owner'

function safeNext(next: string | null): string | null {
  if (next && next.startsWith('/') && !next.startsWith('//')) return next
  return null
}

function Choice({ icon: Icon, title, body, onClick, to }: { icon: LucideIcon; title: string; body: string; onClick?: () => void; to?: string }) {
  const inner = (
    <>
      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-forest-50 text-forest-800">
        <Icon className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold text-ink">{title}</span>
        <span className="block text-[13px] leading-snug text-ink-soft">{body}</span>
      </span>
      <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
    </>
  )
  const cls = 'flex w-full cursor-pointer items-center gap-3 rounded-lg border border-line-strong bg-surface p-4 text-left transition-colors hover:border-forest-700/50 hover:bg-forest-50/60'
  return to ? (
    <Link to={to} className={cls}>
      {inner}
    </Link>
  ) : (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  )
}

function InviteLinkBox() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string>()
  if (!open)
    return (
      <Button type="button" variant="outline" className="w-full" onClick={() => setOpen(true)}>
        <Link2 /> I have an invite link
      </Button>
    )
  return (
    <form
      className="space-y-3 rounded-md border border-line bg-paper/60 p-3"
      onSubmit={(e) => {
        e.preventDefault()
        const token = inviteTokenFrom(value)
        if (!token) return setError('Paste the whole link your shop sent you. It contains “join?token=”.')
        navigate(`/join?token=${encodeURIComponent(token)}`)
      }}
    >
      <Field id="invite-link" label="Paste your invite link" hint="You can also just tap the link in WhatsApp — it opens this site." error={error}>
        <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://…/join?token=…" />
      </Field>
      <Button type="submit" className="w-full">
        Open my invite
      </Button>
    </form>
  )
}

export function SignInPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const [formError, setFormError] = useState<string>()
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '', password: '' } })
  const next = safeNext(params.get('next'))
  const asParam = params.get('as')
  const as: As | null = asParam === 'barber' || asParam === 'owner' ? asParam : next?.startsWith('/join') ? 'barber' : null
  const choose = (v: As | null) => {
    const p = new URLSearchParams(params)
    if (v) p.set('as', v)
    else p.delete('as')
    setFormError(undefined)
    setParams(p)
  }
  const customerHref = `/c/sign-in${next && (next.startsWith('/c') || next.startsWith('/p/')) ? `?next=${encodeURIComponent(next)}` : ''}`

  const onSubmit = handleSubmit(async (values) => {
    setFormError(undefined)
    try {
      const { error } = await requireSupabase().auth.signInWithPassword(values)
      if (error) {
        // Do not reveal whether the account exists.
        setFormError(
          /confirm/i.test(error.message)
            ? 'Confirm your email address first — check your inbox for the link we sent.'
            : 'Email or password is incorrect.',
        )
        return
      }
      // /start sends barbers to their workspace and owners / managers to the overview.
      navigate(next ?? '/start', { replace: true })
    } catch {
      setFormError('Could not reach the sign-in service. Check your connection and try again.')
    }
  })

  const notices = (
    <>
      {params.get('expired') && (
        <Callout tone="warning" className="mt-5" title="Your session ended">
          Sign in again to continue.
        </Callout>
      )}
      {params.get('reset') && (
        <Callout tone="info" className="mt-5" title="Password updated">
          Sign in with your new password.
        </Callout>
      )}
    </>
  )

  if (!as)
    return (
      <div>
        <h1 className="text-2xl font-bold">Sign in</h1>
        <p className="mt-1 text-[15px] text-ink-soft">Who are you signing in as?</p>
        {notices}
        <div className="mt-6 flex flex-col gap-3" role="list" aria-label="Choose how to sign in">
          <div role="listitem">
            <Choice icon={UserRound} title="I’m a customer" body="Book a haircut and see your bookings. One-time code by email, no password." to={customerHref} />
          </div>
          <div role="listitem">
            <Choice icon={Scissors} title="I’m a barber" body="Sign in with the email your shop invited." onClick={() => choose('barber')} />
          </div>
          <div role="listitem">
            <Choice icon={Store} title="I’m a shop owner" body="Manage your bookings, team and money." onClick={() => choose('owner')} />
          </div>
        </div>
        <p className="mt-6 text-center text-sm text-ink-soft">
          New shop on KasiFlow?{' '}
          <Link to="/sign-up" className="font-semibold text-forest-800 hover:underline">
            Create a shop account
          </Link>
        </p>
      </div>
    )

  const signUpHref = next ? `/sign-up?next=${encodeURIComponent(next)}` : '/sign-up'

  return (
    <div>
      <button type="button" onClick={() => choose(null)} className="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-forest-800 hover:underline">
        <ArrowLeft className="size-4" aria-hidden /> Choose another option
      </button>
      <h1 className="text-2xl font-bold">{as === 'barber' ? 'Barber sign in' : 'Shop owner sign in'}</h1>
      <p className="mt-1 text-[15px] text-ink-soft">
        {as === 'barber' ? 'Use the email address your shop invited, and the password you chose.' : 'Welcome back. Pick up where you left off.'}
      </p>
      {notices}
      {as === 'barber' && (
        <div className="mt-5 space-y-3">
          <Callout tone="info" title={next?.startsWith('/join') ? 'You opened an invite link' : 'First time?'}>
            {next?.startsWith('/join')
              ? 'Sign in, or create your login with the invited email, and you will join the shop straight away.'
              : 'You need the invite link from your shop owner first. Open it, then create your login with the same email.'}
          </Callout>
          {!next?.startsWith('/join') && <InviteLinkBox />}
        </div>
      )}
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field id="email" label="Email" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field id="password" label="Password" error={formState.errors.password?.message}>
          <Input type="password" autoComplete="current-password" {...register('password')} />
        </Field>
        <div className="-mt-1 text-right">
          <Link to="/forgot-password" className="text-sm font-medium text-forest-800 hover:underline">
            Forgot password?
          </Link>
        </div>
        {formError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" loading={formState.isSubmitting}>
          Sign in
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-soft">
        {as === 'barber' ? (
          next?.startsWith('/join') ? (
            <>
              No login yet?{' '}
              <Link to={signUpHref} className="font-semibold text-forest-800 hover:underline">
                Create your login
              </Link>
            </>
          ) : (
            'Barber logins are created from your shop’s invite link.'
          )
        ) : (
          <>
            New to KasiFlow?{' '}
            <Link to={signUpHref} className="font-semibold text-forest-800 hover:underline">
              Create a shop account
            </Link>
          </>
        )}
      </p>
    </div>
  )
}
