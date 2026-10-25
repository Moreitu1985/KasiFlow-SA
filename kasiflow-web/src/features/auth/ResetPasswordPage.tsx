import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Link, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Callout } from '@/components/shared/Callout'
import { requireSupabase } from '@/lib/supabase'
import { useAuth } from './AuthProvider'

const schema = z
  .object({
    password: z.string().min(8, 'Use at least 8 characters.').max(72, 'Use 72 characters or fewer.'),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, { path: ['confirm'], message: 'Passwords do not match.' })
type Values = z.infer<typeof schema>

export function ResetPasswordPage() {
  const { recovery, session, loading, signOut } = useAuth()
  const navigate = useNavigate()
  const [waited, setWaited] = useState(false)
  const [formError, setFormError] = useState<string>()
  const { register, handleSubmit, formState } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { password: '', confirm: '' } })

  // Supabase parses the recovery token from the URL and fires PASSWORD_RECOVERY. Give it a moment.
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2500)
    return () => clearTimeout(t)
  }, [])

  // The reset link signs the user in (Supabase fires PASSWORD_RECOVERY). Any session on this page may set a new password.
  const ready = recovery || !!session

  const onSubmit = handleSubmit(async ({ password }) => {
    setFormError(undefined)
    const { error } = await requireSupabase().auth.updateUser({ password })
    if (error) {
      setFormError(error.message || 'Could not update your password. Request a new link and try again.')
      return
    }
    toast.success('Password updated')
    await signOut()
    navigate('/sign-in?reset=1', { replace: true })
  })

  if (!ready) {
    if (loading || !waited)
      return (
        <p role="status" className="text-sm text-ink-muted">
          Checking your reset link…
        </p>
      )
    return (
      <div>
        <h1 className="text-2xl font-bold">Link not valid</h1>
        <Callout tone="warning" className="mt-5">
          This reset link is missing, expired or has already been used. Request a new one.
        </Callout>
        <Button asChild className="mt-6 w-full" size="lg">
          <Link to="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    )
  }

  return (
    <div>
      <h1 className="text-2xl font-bold">Choose a new password</h1>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4" noValidate>
        <Field id="password" label="New password" hint="At least 8 characters." error={formState.errors.password?.message}>
          <Input type="password" autoComplete="new-password" {...register('password')} />
        </Field>
        <Field id="confirm" label="Confirm new password" error={formState.errors.confirm?.message}>
          <Input type="password" autoComplete="new-password" {...register('confirm')} />
        </Field>
        {formError && (
          <p role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
            {formError}
          </p>
        )}
        <Button type="submit" size="lg" loading={formState.isSubmitting}>
          Update password
        </Button>
      </form>
    </div>
  )
}
