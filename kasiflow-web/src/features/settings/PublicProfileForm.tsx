import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Copy, ExternalLink } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, Textarea } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { handleFormError } from '@/lib/forms'
import { nullIfEmpty, optionalText } from '@/lib/validation'
import { ProfileView } from '@/features/public-profile/ProfileView'
import type { BusinessDto, PublicProfileSettingsDto } from '@/types/api'
import { useUpdatePublicProfile } from './api'

const schema = z.object({
  slug: z
    .string()
    .trim()
    .min(3, 'Use at least 3 characters.')
    .max(80, 'Use 80 characters or fewer.')
    .regex(/^[a-z0-9-]+$/, 'Use only lowercase letters, numbers and dashes.'),
  isPublished: z.boolean(),
  description: optionalText(2000),
  category: optionalText(120),
  productsServices: optionalText(2000),
  showPhone: z.boolean(),
  showEmail: z.boolean(),
  showTown: z.boolean(),
  serviceArea: optionalText(500),
  openingHours: optionalText(500),
  imageUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || /^https:\/\/[^\s]+$/.test(v), 'The image link must start with https://'),
})
type Values = z.infer<typeof schema>

function suggestSlug(name: string) {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export function PublicProfileForm({ profile, business }: { profile: PublicProfileSettingsDto; business: BusinessDto }) {
  const update = useUpdatePublicProfile()
  const { register, handleSubmit, formState, reset, setError, control, setValue } = useForm<Values>({ resolver: zodResolver(schema) })
  useEffect(() => {
    reset({
      slug: profile.slug ?? suggestSlug(business.name),
      isPublished: profile.isPublished,
      description: profile.description ?? '',
      category: profile.category ?? business.businessType,
      productsServices: profile.productsServices ?? '',
      showPhone: profile.showPhone,
      showEmail: profile.showEmail,
      showTown: profile.showTown,
      serviceArea: profile.serviceArea ?? '',
      openingHours: profile.openingHours ?? '',
      imageUrl: profile.imageUrl ?? '',
    })
  }, [profile, business, reset])
  const v = useWatch({ control })
  const e = formState.errors
  const path = profile.publicUrlPath ?? (profile.slug ? `/p/${profile.slug}` : null)
  const publicUrl = path ? `${window.location.origin}${path}` : null
  const live = profile.exists && profile.isPublished && publicUrl

  const submit = handleSubmit(async (val) => {
    try {
      await update.mutateAsync({
        slug: val.slug,
        isPublished: val.isPublished,
        description: nullIfEmpty(val.description),
        category: nullIfEmpty(val.category),
        productsServices: nullIfEmpty(val.productsServices),
        showPhone: val.showPhone,
        showEmail: val.showEmail,
        showTown: val.showTown,
        serviceArea: nullIfEmpty(val.serviceArea),
        openingHours: nullIfEmpty(val.openingHours),
        imageUrl: nullIfEmpty(val.imageUrl),
      })
      toast.success(val.isPublished ? 'Profile saved and published' : 'Profile saved (not published)')
    } catch (err) {
      handleFormError(err, setError)
    }
  })

  const copy = async () => {
    if (!publicUrl) return
    try {
      await navigator.clipboard.writeText(publicUrl)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy', { description: publicUrl })
    }
  }

  const imageOk = !!v.imageUrl && /^https:\/\/[^\s]+$/.test(v.imageUrl)

  return (
    <div className="grid gap-8 xl:grid-cols-2">
      <form onSubmit={submit} noValidate className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper p-3">
          <div>
            <Label htmlFor="pp-published">Publish profile</Label>
            <p className="text-[13px] text-ink-muted">When on, anyone with the link can see it.</p>
          </div>
          <Switch id="pp-published" checked={!!v.isPublished} onCheckedChange={(c) => setValue('isPublished', c, { shouldDirty: true })} />
        </div>
        {live && (
          <div className="flex flex-col gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 sm:flex-row sm:items-center">
            <p className="min-w-0 flex-1 truncate text-sm font-medium text-emerald-900">{publicUrl}</p>
            <div className="flex gap-2">
              <Button type="button" size="sm" variant="outline" onClick={copy}>
                <Copy /> Copy link
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={path!} target="_blank" rel="noopener noreferrer">
                  <ExternalLink /> Open
                </a>
              </Button>
            </div>
          </div>
        )}
        <Field id="pp-slug" label="Link name" hint={`Your link will be ${window.location.origin}/p/${v.slug || 'your-name'}`} error={e.slug?.message}>
          <Input autoCapitalize="off" spellCheck={false} {...register('slug')} />
        </Field>
        <Field id="pp-cat" label="Category" optional error={e.category?.message}>
          <Input placeholder="e.g. Barber" {...register('category')} />
        </Field>
        <Field id="pp-desc" label="About the business" optional error={e.description?.message}>
          <Textarea rows={3} {...register('description')} />
        </Field>
        <Field id="pp-products" label="Products & services" optional hint="One per line." error={e.productsServices?.message}>
          <Textarea rows={3} {...register('productsServices')} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pp-hours" label="Opening hours" optional error={e.openingHours?.message}>
            <Textarea rows={2} placeholder="Mon–Sat 7:00–19:00" {...register('openingHours')} />
          </Field>
          <Field id="pp-area" label="Service area" optional error={e.serviceArea?.message}>
            <Textarea rows={2} placeholder="e.g. Delivers in Orlando East and Noordgesig" {...register('serviceArea')} />
          </Field>
        </div>
        <Field id="pp-image" label="Image link" optional hint="A photo of your shop or work, hosted elsewhere. Must start with https://" error={e.imageUrl?.message}>
          <Input type="url" placeholder="https://" {...register('imageUrl')} />
        </Field>
        <fieldset className="rounded-md border border-line p-3">
          <legend className="px-1 text-sm font-medium">Contact details to show</legend>
          <p className="mb-2 text-[13px] text-ink-muted">Nothing is shown unless you tick it.</p>
          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-sm">
              <Checkbox {...register('showPhone')} /> Phone {business.contactPhone ? `(${business.contactPhone})` : '(none saved)'}
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox {...register('showEmail')} /> Email ({business.contactEmail})
            </label>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox {...register('showTown')} /> Town {business.town ? `(${business.town})` : '(none saved)'}
            </label>
          </div>
        </fieldset>
        <Button type="submit" loading={formState.isSubmitting} className="self-start">
          Save public profile
        </Button>
      </form>
      <div>
        <p className="mb-2 text-sm font-semibold">Preview</p>
        <div className="rounded-lg bg-paper p-3 ring-1 ring-line">
          <ProfileView
            p={{
              slug: v.slug ?? '',
              businessName: business.name,
              description: v.description || null,
              category: v.category || null,
              productsServices: v.productsServices || null,
              province: business.province,
              town: v.showTown ? business.town : null,
              serviceArea: v.serviceArea || null,
              openingHours: v.openingHours || null,
              imageUrl: imageOk ? v.imageUrl! : null,
              phone: v.showPhone ? business.contactPhone : null,
              email: v.showEmail ? business.contactEmail : null,
            }}
          />
        </div>
        <p className="mt-2 text-[12px] text-ink-muted">The live page shows only what the server returns for your published profile.</p>
      </div>
    </div>
  )
}
