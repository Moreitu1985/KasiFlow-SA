import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect } from '@/components/ui/input'
import { BUSINESS_TYPES, PROVINCES, REGISTRATION_STATUS, entries } from '@/lib/labels'
import { nullIfEmpty, optionalPhone, optionalText, requiredText } from '@/lib/validation'
import { handleFormError } from '@/lib/forms'
import type { BusinessDto, BusinessInput, Province, RegistrationStatus } from '@/types/api'

const provinceKeys = Object.keys(PROVINCES) as [Province, ...Province[]]
const regKeys = Object.keys(REGISTRATION_STATUS) as [RegistrationStatus, ...RegistrationStatus[]]

const schema = z.object({
  name: requiredText('Business name', 120),
  businessType: requiredText('Business type', 80),
  ownerName: requiredText('Owner or contact name', 120),
  contactEmail: z.string().trim().min(1, 'Contact email is required.').pipe(z.email('Enter a valid email address.')),
  contactPhone: optionalPhone,
  province: z.enum(provinceKeys, { message: 'Choose a province.' }),
  town: optionalText(120),
  registrationStatus: z.enum(regKeys, { message: 'Choose a registration status.' }),
})
export type BusinessFormValues = z.infer<typeof schema>

export function toBusinessInput(v: BusinessFormValues): BusinessInput {
  return {
    name: v.name.trim(),
    businessType: v.businessType,
    ownerName: v.ownerName.trim(),
    contactEmail: v.contactEmail.trim(),
    contactPhone: nullIfEmpty(v.contactPhone),
    province: v.province,
    town: nullIfEmpty(v.town),
    registrationStatus: v.registrationStatus,
  }
}

export function BusinessForm({
  initial,
  defaultEmail,
  submitLabel,
  onSubmit,
}: {
  initial?: BusinessDto
  defaultEmail?: string
  submitLabel: string
  onSubmit: (input: BusinessInput) => Promise<unknown>
}) {
  const knownType = initial ? (BUSINESS_TYPES as readonly string[]).includes(initial.businessType) : true
  const { register, handleSubmit, formState, setError } = useForm<BusinessFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: initial?.name ?? '',
      businessType: initial?.businessType ?? '',
      ownerName: initial?.ownerName ?? '',
      contactEmail: initial?.contactEmail ?? defaultEmail ?? '',
      contactPhone: initial?.contactPhone ?? '',
      province: initial?.province,
      town: initial?.town ?? '',
      registrationStatus: initial?.registrationStatus,
    },
  })
  const e = formState.errors

  const submit = handleSubmit(async (values) => {
    try {
      await onSubmit(toBusinessInput(values))
    } catch (err) {
      handleFormError(err, setError, {
        name: 'name',
        businessType: 'businessType',
        ownerName: 'ownerName',
        contactEmail: 'contactEmail',
        contactPhone: 'contactPhone',
        province: 'province',
        town: 'town',
        registrationStatus: 'registrationStatus',
      })
    }
  })

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-5">
      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="biz-name" label="Business name" error={e.name?.message} className="sm:col-span-2">
          <Input autoComplete="organization" {...register('name')} />
        </Field>
        <Field id="biz-type" label="Business type" error={e.businessType?.message}>
          <NativeSelect {...register('businessType')}>
            <option value="" disabled>
              Choose a type
            </option>
            {!knownType && initial && <option value={initial.businessType}>{initial.businessType}</option>}
            {BUSINESS_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="biz-owner" label="Owner or contact name" error={e.ownerName?.message}>
          <Input autoComplete="name" {...register('ownerName')} />
        </Field>
        <Field id="biz-email" label="Contact email" error={e.contactEmail?.message}>
          <Input type="email" autoComplete="email" {...register('contactEmail')} />
        </Field>
        <Field id="biz-phone" label="Phone" optional error={e.contactPhone?.message}>
          <Input type="tel" autoComplete="tel" placeholder="071 234 5678" {...register('contactPhone')} />
        </Field>
        <Field id="biz-province" label="Province" error={e.province?.message}>
          <NativeSelect defaultValue={initial?.province ?? ''} {...register('province')}>
            <option value="" disabled>
              Choose a province
            </option>
            {entries(PROVINCES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="biz-town" label="Town or township" optional error={e.town?.message}>
          <Input autoComplete="address-level2" placeholder="e.g. Soweto" {...register('town')} />
        </Field>
      </div>

      <fieldset>
        <legend className="text-sm font-medium text-ink">Business registration status</legend>
        <p className="mt-0.5 text-[13px] text-ink-muted">For example with CIPC. You can change this later.</p>
        <div className="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {entries(REGISTRATION_STATUS).map(([k, label]) => (
            <label
              key={k}
              className="flex cursor-pointer items-center gap-2 rounded-md border border-line-strong bg-surface px-3 py-2.5 text-sm has-[:checked]:border-forest-800 has-[:checked]:bg-forest-50 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-emerald-brand"
            >
              <input type="radio" value={k} className="accent-forest-800" {...register('registrationStatus')} />
              {label}
            </label>
          ))}
        </div>
        {e.registrationStatus && (
          <p role="alert" className="mt-1.5 text-[13px] font-medium text-red-700">
            {e.registrationStatus.message}
          </p>
        )}
      </fieldset>

      <div className="rounded-md border border-line bg-paper px-3 py-2.5 text-sm">
        <span className="text-ink-muted">Currency: </span>
        <span className="font-medium">ZAR (South African rand)</span>
      </div>

      <div>
        <Button type="submit" size="lg" loading={formState.isSubmitting} className="w-full sm:w-auto">
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
