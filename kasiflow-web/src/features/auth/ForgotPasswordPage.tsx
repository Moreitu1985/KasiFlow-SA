import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Callout } from '@/components/shared/Callout'
import { requireSupabase } from '@/lib/supabase'

const schema = z.object({ email: z.string().trim().min(1, 'Email is required.').pipe(z.email('Enter a valid email address.')) })
type Values = z.infer<typeof schema>

export function ForgotPasswordPage() {
  const [sent, setSent] = useState(false)
  const [formError, setFormError] = useState<string>()
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { email: '' } })

  const onSubmit = handleSubmit(async ({ email }) => {
    setFormError(undefined)
    try {
      const { error } = await requireSupabase().auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      })
      if (error && /rate|limit/i.test(error.message)) {
        setFormError('Too many attempts. Wait a few minutes and try again.')
        return
      }
      setSent(true)
    } catch {
      setFormError('Could not reach the sign-in service. Check your connection and try again.')
    }
  })

  return (
    <div>
      <h1 className="text-2xl font-bold">Reset your password</h1>
      <p className="mt-1 text-[15px] text-ink-soft">We will email you a link to choose a new password.</p>
      {sent ? (
        <Callout tone="info" className="mt-6" title="Check your email">
          If an account exists for that address, a reset link is on its way. The link opens this site so you can set a new
          password.
        </Callout>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
          <Field id="email" label="Email" error={formState.errors.email?.message}>
            <Input type="email" autoComplete="email" {...register('email')} />
          </Field>
          {formError && (
            <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
              {formError}
            </p>
          )}
          <Button type="submit" size="lg" loading={formState.isSubmitting}>
            Send reset link
          </Button>
        </form>
      )}
      <p className="mt-6 text-center text-sm">
        <Link to="/sign-in" className="font-semibold text-forest-800 hover:underline">
          Back to sign in
        </Link>
      </p>
    </div>
  )
}
