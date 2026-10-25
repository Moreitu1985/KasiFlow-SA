import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { MailCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { requireSupabase } from '@/lib/supabase'

const schema = z
  .object({
    email: z.string().trim().min(1, 'Email is required.').pipe(z.email('Enter a valid email address.')),
    password: z.string().min(8, 'Use at least 8 characters.').max(72, 'Use 72 characters or fewer.'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match.' })
type Values = z.infer<typeof schema>

/** Only same-site paths, e.g. an invitation link (/join?token=…) the person opened before signing up. */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null
}

export function SignUpPage() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const next = safeNext(params.get('next'))
  const joining = !!next?.startsWith('/join')
  const [sentTo, setSentTo] = useState<string>()
  const [formError, setFormError] = useState<string>()
  const { register, handleSubmit, formState } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '', confirm: '' },
  })

  const onSubmit = handleSubmit(async ({ email, password }) => {
    setFormError(undefined)
    try {
      const { data, error } = await requireSupabase().auth.signUp({
        email,
        password,
        options: { emailRedirectTo: `${window.location.origin}/sign-in${next ? `?next=${encodeURIComponent(next)}` : ''}` },
      })
      if (error) {
        setFormError(signUpErrorMessage(error.message, error.status))
        return
      }
      if (data.session) navigate(next ?? '/start', { replace: true })
      else setSentTo(email)
    } catch {
      setFormError('Could not reach the sign-up service. Check your connection and try again.')
    }
  })

  if (sentTo) {
    return (
      <div role="status">
        <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-forest-50 text-forest-800">
          <MailCheck className="size-6" aria-hidden />
        </div>
        <h1 className="text-2xl font-bold">Check your email</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-ink-soft">
          If <strong className="text-ink">{sentTo}</strong> can be used for a new account, we have sent a confirmation link
          to it. Open the link, then come back and sign in.
        </p>
        <p className="mt-3 text-sm text-ink-muted">No email after a few minutes? Check your spam folder.</p>
        <Button asChild className="mt-6 w-full" size="lg">
          <Link to="/sign-in">Go to sign in</Link>
        </Button>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">{joining ? 'Create your login to join the shop' : 'Create your shop account'}</h1>
      <p className="mt-1 text-[15px] text-ink-soft">
        {joining
          ? 'Use the same email address your shop invited. After you confirm it, you join the shop straight away.'
          : 'For shop owners. Free to start. You will set up your business next.'}
      </p>
      {!joining && (
        <p className="mt-3 rounded-md bg-paper px-3 py-2 text-[13px] leading-relaxed text-ink-soft">
          <strong className="text-ink">Barber?</strong> Open the invite link from your shop owner first.{' '}
          <strong className="text-ink">Customer?</strong> No account needed:{' '}
          <Link to="/c/sign-in" className="font-semibold text-forest-800 hover:underline">
            sign in with a one-time code
          </Link>{' '}
          to book.
        </p>
      )}
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field id="email" label="Email" error={formState.errors.email?.message}>
          <Input type="email" autoComplete="email" {...register('email')} />
        </Field>
        <Field id="password" label="Password" hint="At least 8 characters." error={formState.errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <Field id="confirm" label="Confirm password" error={formState.errors.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...register('confirm')} />
        </Field>
        {formError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" loading={formState.isSubmitting}>
          {joining ? 'Create my login' : 'Create shop account'}
        </Button>
      </form>
      <p className="mt-6 text-center text-sm text-ink-soft">
        Already have an account?{' '}
        <Link to={next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in'} className="font-semibold text-forest-800 hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  )
}

/** Maps Supabase sign-up errors to helpful messages without revealing whether an email is already registered. */
function signUpErrorMessage(message: string, status?: number): string {
  if (/invalid api key|no api key|apikey/i.test(message) || status === 401)
    return 'Sign-up is not configured correctly: the Supabase anon key in .env.local is missing or wrong.'
  if (/rate limit|too many/i.test(message) || status === 429)
    return 'Too many sign-up attempts or emails sent. Wait a few minutes and try again.'
  if (/signups? not allowed|disabled/i.test(message)) return 'New sign-ups are currently disabled for this project.'
  if (/password/i.test(message)) return message
  if (/email/i.test(message) && /invalid/i.test(message)) return 'Enter a valid email address.'
  return 'Could not create the account. Check your details and try again.'
}
