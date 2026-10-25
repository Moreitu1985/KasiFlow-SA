import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Download, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { NativeSelect, Textarea } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Callout } from '@/components/shared/Callout'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { ErrorState, ListSkeleton } from '@/components/shared/States'
import { centsToRandInput, parseRandToCents } from '@/lib/format'
import { handleFormError } from '@/lib/forms'
import { BANK_ACCOUNT_STATUS, entries } from '@/lib/labels'
import { nullIfEmpty, optionalRand, optionalText } from '@/lib/validation'
import { ChecklistItem } from '@/features/registration/ChecklistItem'
import { useCsvExport } from '@/features/reports/api'
import { useAccess } from '@/features/access/useAccess'
import type { BankAccountStatus, FundingProfileDto } from '@/types/api'
import { useFundingReadiness, useUpdateFundingItem, useUpdateFundingProfile } from './api'

const profileSchema = z.object({
  fundingPurpose: optionalText(1000),
  amount: optionalRand(),
  bank: z.string(),
})
type ProfileValues = z.infer<typeof profileSchema>

function FundingProfileForm({ profile }: { profile: FundingProfileDto }) {
  const update = useUpdateFundingProfile()
  const { register, handleSubmit, formState, reset, setError } = useForm<ProfileValues>({ resolver: zodResolver(profileSchema) })
  useEffect(() => {
    reset({
      fundingPurpose: profile.fundingPurpose ?? '',
      amount: profile.amountRequestedCents !== null ? centsToRandInput(profile.amountRequestedCents) : '',
      bank: profile.businessBankAccountStatus ?? '',
    })
  }, [profile, reset])
  const e = formState.errors
  const submit = handleSubmit(async (v) => {
    try {
      await update.mutateAsync({
        fundingPurpose: nullIfEmpty(v.fundingPurpose),
        amountRequestedCents: v.amount === '' ? null : parseRandToCents(v.amount),
        businessBankAccountStatus: v.bank === '' ? null : (v.bank as BankAccountStatus),
      })
      toast.success('Funding profile saved')
    } catch (err) {
      handleFormError(err, setError, { fundingPurpose: 'fundingPurpose', amountRequestedCents: 'amount', businessBankAccountStatus: 'bank' })
    }
  })
  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      <Field id="f-purpose" label="What would you use funding for?" optional error={e.fundingPurpose?.message}>
        <Textarea rows={3} placeholder="e.g. A second fridge so I can stock cold drinks in summer" {...register('fundingPurpose')} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="f-amount" label="Amount you need" optional error={e.amount?.message}>
          <MoneyInput {...register('amount')} />
        </Field>
        <Field id="f-bank" label="Business bank account" optional error={e.bank?.message}>
          <NativeSelect {...register('bank')}>
            <option value="">Not answered</option>
            {entries(BANK_ACCOUNT_STATUS).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <Button type="submit" variant="secondary" loading={formState.isSubmitting} className="self-start">
        Save funding profile
      </Button>
    </form>
  )
}

export function FundingTab() {
  const q = useFundingReadiness()
  const updateItem = useUpdateFundingItem()
  const csv = useCsvExport()
  const { can } = useAccess()
  if (q.isLoading) return <ListSkeleton rows={4} />
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />
  const f = q.data
  if (!f) return null

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-lg border border-line bg-surface p-5 lg:flex-row lg:items-center">
        <div className="flex-1">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <p className="text-sm font-medium">
              {f.completedCount} of {f.totalCount} items ready
            </p>
            <p className="font-display text-2xl font-bold tabular">{Math.round(f.percent)}%</p>
          </div>
          <Progress value={f.percent} label="Funding readiness" />
          <p className="mt-2 text-[13px] text-ink-muted">This is not a credit score. It shows which records and documents funders commonly ask for.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('viewBusinessInsights') && (
            <Button asChild variant="outline">
              <Link to="/reports/business-summary">
                <FileText /> View business summary
              </Link>
            </Button>
          )}
          <Button variant="outline" loading={csv.pending === 'readiness'} onClick={() => csv.run('readiness')}>
            <Download /> Export CSV
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {f.items.map((it) => (
          <ChecklistItem
            key={it.key}
            id={`fund-${it.key}`}
            title={it.title}
            completed={it.completed}
            notes={it.notes}
            locked={it.mode === 'automatic'}
            lockedReason="Updated automatically from your records"
            badges={it.mode === 'automatic' ? <Badge variant="info">Automatic</Badge> : <Badge variant="outline">You confirm</Badge>}
            onSave={(completed, notes) => updateItem.mutateAsync({ key: it.key, completed: it.mode === 'automatic' ? it.completed : completed, notes })}
          >
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{it.description}</p>
            {!it.completed && (
              <div className="mt-2 rounded-md bg-paper px-3 py-2 text-[13px] leading-relaxed">
                <span className="font-semibold">How to complete: </span>
                {it.howToComplete}
                {it.appRoute && (
                  <>
                    {' '}
                    <Link to={it.appRoute} className="font-semibold text-forest-800 hover:underline">
                      Go there in KasiFlow
                    </Link>
                  </>
                )}
              </div>
            )}
            {it.mode === 'automatic' && <p className="mt-1.5 text-[12px] text-ink-muted">Ticked automatically when your records meet this item. You can still add notes.</p>}
          </ChecklistItem>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Funding profile</CardTitle>
          <CardDescription>Shown on your printable business summary. Optional.</CardDescription>
        </CardHeader>
        <CardContent>
          <FundingProfileForm profile={f.profile} />
        </CardContent>
      </Card>

      <Callout tone="neutral" title="Please note">
        {f.disclaimer}
      </Callout>
    </div>
  )
}
