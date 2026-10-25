import { useEffect, useRef, useState } from 'react'
import { Mail, MailCheck, Smartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { env } from '@/lib/env'
import { requireSupabase } from '@/lib/supabase'
import { cleanOtp, isEmail, isValidOtp, otpErrorMessage, toE164 } from '@/lib/customer'
import { cn } from '@/lib/utils'

type Channel = 'email' | 'phone'

const RESEND_SECONDS = 60

/**
 * Customer sign-in with a one-time code: enter email (or phone when SMS is enabled) → enter the 6-digit code.
 * No password and no profile to create. Supabase creates the login on first use and sends the code; the link in the
 * same email also works (it returns to `redirectTo`, where Supabase picks the session up from the URL).
 */
export function OtpSignIn({ onVerified, redirectTo, idPrefix = 'otp', autoFocus }: { onVerified?: () => void; redirectTo?: string; idPrefix?: string; autoFocus?: boolean }) {
  const [channel, setChannel] = useState<Channel>('email')
  const [step, setStep] = useState<'contact' | 'code' | 'password'>('contact')
  const [password, setPassword] = useState('')
  const [contact, setContact] = useState('')
  const [sentTo, setSentTo] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [cooldown, setCooldown] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)
  const contactRef = useRef<HTMLInputElement>(null)
  const smsEnabled = env.customerSmsOtp

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault()
    setError(undefined)
    const value = contact.trim()
    let target: string | null = value
    if (channel === 'email' && !isEmail(value)) return setError('Enter a valid email address.')
    if (channel === 'phone') {
      target = toE164(value)
      if (!target) return setError('Enter a South African cellphone number, e.g. 082 123 4567.')
    }
    setBusy(true)
    try {
      const auth = requireSupabase().auth
      const { error: err } =
        channel === 'email'
          ? await auth.signInWithOtp({ email: target!, options: { shouldCreateUser: true, emailRedirectTo: redirectTo ?? window.location.href } })
          : await auth.signInWithOtp({ phone: target!, options: { shouldCreateUser: true } })
      if (err) {
        setError(otpErrorMessage(err.message, err.status))
        return
      }
      setSentTo(target!)
      setCode('')
      setStep('code')
      setCooldown(RESEND_SECONDS)
    } catch {
      setError('Could not reach the sign-in service. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const verify = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(undefined)
    if (!isValidOtp(code)) return setError('Enter the 6-digit code.')
    setBusy(true)
    try {
      const auth = requireSupabase().auth
      const token = cleanOtp(code)
      const { error: err } =
        channel === 'email' ? await auth.verifyOtp({ email: sentTo, token, type: 'email' }) : await auth.verifyOtp({ phone: sentTo, token, type: 'sms' })
      if (err) {
        setError(otpErrorMessage(err.message, err.status))
        return
      }
      onVerified?.()
    } catch {
      setError('Could not reach the sign-in service. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const passwordSignIn = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(undefined)
    const email = contact.trim()
    if (!isEmail(email)) return setError('Enter a valid email address.')
    if (!password) return setError('Enter the password.')
    setBusy(true)
    try {
      const { error: err } = await requireSupabase().auth.signInWithPassword({ email, password })
      if (err) {
        setError(err.status === 400 ? 'That email and password do not match a demo account.' : err.message)
        return
      }
      onVerified?.()
    } catch {
      setError('Could not reach the sign-in service. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const errorBox = error && (
    <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
      {error}
    </p>
  )

  if (step === 'password')
    return (
      <form onSubmit={passwordSignIn} noValidate className="flex flex-col gap-4">
        <p className="rounded-md bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
          Demo accounts only. Real customers sign in with a one-time code.
        </p>
        <Field id={`${idPrefix}-demo-email`} label="Demo email">
          <Input type="email" autoComplete="username" value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
        <Field id={`${idPrefix}-demo-password`} label="Password">
          <Input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </Field>
        {errorBox}
        <Button type="submit" size="lg" loading={busy}>
          Sign in
        </Button>
        <button
          type="button"
          className="cursor-pointer self-start text-sm font-semibold text-forest-800 hover:underline"
          onClick={() => {
            setStep('contact')
            setError(undefined)
          }}
        >
          Use a one-time code instead
        </button>
      </form>
    )

  if (step === 'code')
    return (
      <form onSubmit={verify} noValidate className="flex flex-col gap-4">
        <div className="flex gap-3 rounded-md bg-forest-50 px-3 py-2.5 text-sm text-ink" role="status">
          <MailCheck className="mt-0.5 size-5 shrink-0 text-forest-800" aria-hidden />
          <p className="min-w-0 [overflow-wrap:anywhere]">
            We sent a 6-digit code to <strong>{sentTo}</strong>.{' '}
            {channel === 'email' ? 'It can take a minute. Check your spam folder too. You can also tap the link in that email.' : 'It can take a minute.'}
          </p>
        </div>
        <Field id={`${idPrefix}-code`} label="6-digit code">
          <Input
            ref={codeRef}
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={9}
            className="h-12 text-center font-mono text-xl tracking-[0.4em]"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/[^\d\s-]/g, ''))}
          />
        </Field>
        {errorBox}
        <Button type="submit" size="lg" loading={busy}>
          Verify and continue
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            className="cursor-pointer font-semibold text-forest-800 hover:underline"
            onClick={() => {
              setStep('contact')
              setError(undefined)
              setTimeout(() => contactRef.current?.focus(), 0)
            }}
          >
            Use a different {channel === 'email' ? 'email' : 'number'}
          </button>
          <button
            type="button"
            disabled={cooldown > 0 || busy}
            className="cursor-pointer font-semibold text-forest-800 hover:underline disabled:cursor-default disabled:text-ink-muted disabled:no-underline"
            onClick={() => void send()}
          >
            {cooldown > 0 ? `Send a new code in ${cooldown}s` : 'Send a new code'}
          </button>
        </div>
      </form>
    )

  return (
    <form onSubmit={send} noValidate className="flex flex-col gap-4">
      {smsEnabled && (
        <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Get the code by">
          {(
            [
              ['email', 'Email', Mail],
              ['phone', 'Phone (SMS)', Smartphone],
            ] as const
          ).map(([k, label, Icon]) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={channel === k}
              onClick={() => {
                setChannel(k)
                setContact('')
                setError(undefined)
              }}
              className={cn(
                'flex h-11 cursor-pointer items-center justify-center gap-2 rounded-md border text-sm font-semibold',
                channel === k ? 'border-primary bg-primary text-primary-fg' : 'border-line-strong bg-surface hover:bg-forest-50',
              )}
            >
              <Icon className="size-4" aria-hidden /> {label}
            </button>
          ))}
        </div>
      )}
      {channel === 'email' ? (
        <Field id={`${idPrefix}-email`} label="Your email" hint="We'll email you a 6-digit code. No password needed.">
          <Input ref={contactRef} type="email" autoComplete="email" inputMode="email" maxLength={160} autoFocus={autoFocus} value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
      ) : (
        <Field id={`${idPrefix}-phone`} label="Your cellphone number" hint="We'll SMS you a 6-digit code. No password needed.">
          <Input ref={contactRef} type="tel" autoComplete="tel" inputMode="tel" maxLength={20} placeholder="082 123 4567" value={contact} onChange={(e) => setContact(e.target.value)} />
        </Field>
      )}
      {errorBox}
      <Button type="submit" size="lg" loading={busy}>
        Send my code
      </Button>
      {env.demoPasswordSignIn && channel === 'email' && (
        <button
          type="button"
          className="cursor-pointer self-start text-sm font-semibold text-forest-800 hover:underline"
          onClick={() => {
            setStep('password')
            setError(undefined)
          }}
        >
          Demo account? Sign in with a password
        </button>
      )}
    </form>
  )
}
