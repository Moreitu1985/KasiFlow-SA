import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect } from '@/components/ui/input'
import { MoneyInput } from '@/components/shared/MoneyInput'
import { centsToRandInput, parseRandToCents, todayJhb } from '@/lib/format'
import { handleFormError } from '@/lib/forms'
import { optionalDate, optionalRand } from '@/lib/validation'
import type { SettingsDto } from '@/types/api'

const schema = z
  .object({
    opening: optionalRand({ allowNegative: true }),
    openingDate: optionalDate.refine((v) => v === '' || v <= todayJhb(), 'The opening balance date cannot be in the future.'),
    buffer: optionalRand(),
    forecastDays: z.string(),
  })
  .refine((v) => v.opening === '' || v.openingDate !== '', {
    path: ['openingDate'],
    message: 'Choose the date you counted this balance.',
  })
type Values = z.infer<typeof schema>

export const FORECAST_DAY_OPTIONS = [7, 14, 30, 60, 90]

export function CashSettingsForm({
  initial,
  onSubmit,
  submitLabel = 'Save cash settings',
  secondary,
  showForecastDays = true,
  readOnly = false,
}: {
  initial?: SettingsDto
  onSubmit: (input: SettingsDto) => Promise<unknown>
  submitLabel?: string
  secondary?: React.ReactNode
  showForecastDays?: boolean
  /** Read-only roles (accountant) see the values but cannot save. */
  readOnly?: boolean
}) {
  const forecastDays = initial?.forecastDays ?? 30
  const { register, handleSubmit, formState, setError } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      opening: initial?.openingBalanceDate ? centsToRandInput(initial.openingCashBalanceCents) : '',
      openingDate: initial?.openingBalanceDate ?? todayJhb(),
      buffer: initial && initial.cashBufferCents > 0 ? centsToRandInput(initial.cashBufferCents) : '',
      forecastDays: String(forecastDays),
    },
  })
  const e = formState.errors
  const dayOptions = FORECAST_DAY_OPTIONS.includes(forecastDays) ? FORECAST_DAY_OPTIONS : [...FORECAST_DAY_OPTIONS, forecastDays].sort((a, b) => a - b)

  const submit = handleSubmit(async (v) => {
    const hasOpening = v.opening !== ''
    try {
      await onSubmit({
        openingCashBalanceCents: hasOpening ? (parseRandToCents(v.opening, { allowNegative: true }) ?? 0) : 0,
        openingBalanceDate: hasOpening ? v.openingDate : null,
        cashBufferCents: v.buffer === '' ? 0 : (parseRandToCents(v.buffer) ?? 0),
        forecastDays: Number(v.forecastDays),
      })
    } catch (err) {
      handleFormError(err, setError, {
        openingCashBalanceCents: 'opening',
        openingBalanceDate: 'openingDate',
        cashBufferCents: 'buffer',
        forecastDays: 'forecastDays',
      })
    }
  })

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <fieldset disabled={readOnly} className="contents">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          id="opening"
          label="Opening cash balance"
          hint="Cash on hand plus money in the business bank account on that date. Use a minus sign for an overdraft."
          error={e.opening?.message}
        >
          <MoneyInput {...register('opening')} />
        </Field>
        <Field id="openingDate" label="Counted on" error={e.openingDate?.message}>
          <Input type="date" max={todayJhb()} {...register('openingDate')} />
        </Field>
        <Field
          id="buffer"
          label="Safety buffer"
          optional
          hint="The minimum cash you want to keep for emergencies. KasiFlow warns you before you drop below it."
          error={e.buffer?.message}
        >
          <MoneyInput {...register('buffer')} />
        </Field>
        {showForecastDays && (
          <Field id="forecastDays" label="Forecast horizon" hint="How far ahead the cash forecast looks by default." error={e.forecastDays?.message}>
            <NativeSelect {...register('forecastDays')}>
              {dayOptions.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </NativeSelect>
          </Field>
        )}
      </div>
      </fieldset>
      {readOnly ? (
        <p className="text-[13px] text-ink-muted">Your role can see these settings but not change them.</p>
      ) : (
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          {secondary}
          <Button type="submit" size="lg" loading={formState.isSubmitting}>
            {submitLabel}
          </Button>
        </div>
      )}
    </form>
  )
}
