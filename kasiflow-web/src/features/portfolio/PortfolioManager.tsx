import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Eye, EyeOff, ImageOff, ImagePlus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, NativeSelect } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { ConfirmDialog } from '@/components/shared/ConfirmDialog'
import { ErrorState } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { checkPortfolioFile, PORTFOLIO_TYPES } from '@/lib/customer'
import { cn } from '@/lib/utils'
import type { StaffServiceDto } from '@/types/barbershop'
import type { PortfolioPhotoDto } from '@/types/customer'
import { useDeletePhoto, usePortfolio, usePortfolioImage, useUpdatePhoto, useUploadPhoto } from './api'

const MAX_PHOTOS = 24

function Thumb({ photo }: { photo: PortfolioPhotoDto }) {
  const img = usePortfolioImage(photo.url)
  if (img.isError)
    return (
      <div className="flex size-full items-center justify-center text-ink-muted">
        <ImageOff className="size-6" aria-label="Photo could not load" />
      </div>
    )
  if (!img.src) return <Skeleton className="size-full rounded-none" />
  return <img src={img.src} alt={photo.caption ?? 'Portfolio photo'} className="size-full object-cover" />
}

function UploadForm({ staffId, services, onDone }: { staffId: string; services: StaffServiceDto[]; onDone: () => void }) {
  const upload = useUploadPhoto(staffId)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [caption, setCaption] = useState('')
  const [serviceId, setServiceId] = useState('')
  const [isPublic, setIsPublic] = useState(true)
  const [consent, setConsent] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!file) return setPreview(null)
    const url = URL.createObjectURL(file)
    setPreview(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const e2: Record<string, string> = {}
    const fileProblem = checkPortfolioFile(file)
    if (fileProblem) e2.file = fileProblem
    if (!consent) e2.consentConfirmed = 'Tick this to confirm the customer agreed. Without it the photo cannot be saved.'
    setErrors(e2)
    if (Object.keys(e2).length || !file) return
    upload.mutate(
      { file, caption, serviceId: serviceId || undefined, consentConfirmed: consent, isPublic },
      {
        onSuccess: () => {
          toast.success(isPublic ? 'Photo added to your public work' : 'Photo added (hidden)')
          onDone()
        },
        onError: (err) => {
          if (err instanceof ApiError && Object.keys(err.errors).length) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])))
          else toast.error('Could not upload the photo', { description: errorMessage(err) })
        },
      },
    )
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-lg border border-line bg-paper/50 p-3 sm:p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="flex size-28 shrink-0 items-center justify-center overflow-hidden rounded-md border border-dashed border-line-strong bg-surface">
          {preview ? <img src={preview} alt="Selected photo preview" className="size-full object-cover" /> : <ImagePlus className="size-7 text-ink-muted" aria-hidden />}
        </div>
        <Field id={`pf-file-${staffId}`} label="Photo" hint="JPEG, PNG or WebP, up to 3 MB." error={errors.file} className="min-w-0 flex-1">
          <Input
            ref={fileRef}
            type="file"
            accept={PORTFOLIO_TYPES.join(',')}
            className="h-auto py-1.5 file:mr-3 file:rounded file:border-0 file:bg-forest-50 file:px-2.5 file:py-1 file:text-sm file:font-semibold file:text-heading"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field id={`pf-caption-${staffId}`} label="Caption" optional error={errors.caption}>
          <Input maxLength={140} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Low fade with a hard part" />
        </Field>
        <Field id={`pf-service-${staffId}`} label="Service" optional error={errors.serviceId}>
          <NativeSelect value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
            <option value="">No specific service</option>
            {services.map((s) => (
              <option key={s.serviceId} value={s.serviceId}>
                {s.serviceName}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`pf-public-${staffId}`}>
          Show on the booking page
          <span className="block text-[12px] font-normal text-ink-muted">Hidden photos are only seen by you and your managers.</span>
        </Label>
        <Switch id={`pf-public-${staffId}`} checked={isPublic} onCheckedChange={setIsPublic} />
      </div>
      <div className={cn('rounded-md border p-3', errors.consentConfirmed ? 'border-red-300 bg-red-50' : 'border-line bg-surface')}>
        <label htmlFor={`pf-consent-${staffId}`} className="flex cursor-pointer items-start gap-2.5 text-sm font-medium">
          <Checkbox id={`pf-consent-${staffId}`} className="mt-0.5" checked={consent} onChange={(e) => setConsent(e.target.checked)} aria-describedby={errors.consentConfirmed ? `pf-consent-err-${staffId}` : undefined} />
          <span>
            The customer in this photo agreed to it being shown publicly.
            <span className="block text-[12px] font-normal text-ink-muted">Required. Ask before you take the photo. Do not upload photos of children without a parent’s OK.</span>
          </span>
        </label>
        {errors.consentConfirmed && (
          <p id={`pf-consent-err-${staffId}`} role="alert" className="mt-1.5 text-[13px] font-medium text-red-700">
            {errors.consentConfirmed}
          </p>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={upload.isPending}>
          <ImagePlus /> Upload photo
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/** "My work": a barber's portfolio photos. Public ones show on the shop's booking page. */
export function PortfolioManager({ staffId, services, title = 'My work', embedded }: { staffId: string; services: StaffServiceDto[]; title?: string; embedded?: boolean }) {
  const q = usePortfolio(staffId)
  const update = useUpdatePhoto(staffId)
  const del = useDeletePhoto(staffId)
  const [adding, setAdding] = useState(false)
  const [deleting, setDeleting] = useState<PortfolioPhotoDto | null>(null)
  const photos = q.data ?? []
  const full = photos.length >= MAX_PHOTOS

  const content = (
    <div className="space-y-4">
      {!adding && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => setAdding(true)} disabled={full || q.isLoading}>
            <ImagePlus /> Add a photo
          </Button>
          <span className="text-[13px] text-ink-muted">
            {photos.length} of {MAX_PHOTOS} photos{full ? ' — remove one to add another' : ''}
          </span>
        </div>
      )}
      {adding && <UploadForm staffId={staffId} services={services} onDone={() => setAdding(false)} />}
      {q.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="aspect-square" />
          ))}
        </div>
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load the photos" />
      ) : photos.length === 0 ? (
        <p className="rounded-md border border-dashed border-line-strong px-4 py-6 text-center text-sm text-ink-muted">
          No photos yet. Add photos of your cuts so new customers can see your work before they book.
        </p>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {photos.map((p) => (
            <li key={p.id} className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-line bg-surface">
              <div className="relative aspect-square bg-paper">
                <Thumb photo={p} />
                <span className="absolute top-1.5 left-1.5">
                  {p.isPublic ? (
                    <Badge variant="success">
                      <Eye aria-hidden /> Public
                    </Badge>
                  ) : (
                    <Badge variant="neutral">
                      <EyeOff aria-hidden /> Hidden
                    </Badge>
                  )}
                </span>
              </div>
              <div className="flex flex-1 flex-col gap-2 p-2.5">
                <div className="min-w-0 text-[13px]">
                  <p className="line-clamp-2 font-medium [overflow-wrap:anywhere]">{p.caption ?? <span className="text-ink-muted">No caption</span>}</p>
                  {p.serviceName && <p className="truncate text-[12px] text-ink-muted">{p.serviceName}</p>}
                </div>
                <div className="mt-auto flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 flex-1 px-2"
                    loading={update.isPending && update.variables?.id === p.id}
                    onClick={() =>
                      update.mutate(
                        { id: p.id, input: { isPublic: !p.isPublic } },
                        {
                          onSuccess: () => toast.success(p.isPublic ? 'Hidden from the booking page' : 'Shown on the booking page'),
                          onError: (e) => toast.error('Could not update the photo', { description: errorMessage(e) }),
                        },
                      )
                    }
                  >
                    {p.isPublic ? 'Hide' : 'Show'}
                  </Button>
                  <Button size="icon-sm" variant="ghost" className="text-red-700 hover:text-red-800" aria-label={`Delete photo${p.caption ? `: ${p.caption}` : ''}`} onClick={() => setDeleting(p)}>
                    <Trash2 />
                  </Button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this photo?"
        description="It is removed from KasiFlow and from the booking page. This cannot be undone."
        confirmLabel="Delete photo"
        destructive
        pending={del.isPending}
        onConfirm={() =>
          deleting &&
          del.mutate(deleting.id, {
            onSuccess: () => {
              toast.success('Photo deleted')
              setDeleting(null)
            },
            onError: (e) => toast.error('Could not delete the photo', { description: errorMessage(e) }),
          })
        }
      />
    </div>
  )

  if (embedded) return content
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="text-lg">{title}</CardTitle>
        <CardDescription>Photos of cuts you did. Public photos appear on your shop’s booking page so new customers can see your work.</CardDescription>
      </CardHeader>
      <CardContent>{content}</CardContent>
    </Card>
  )
}
