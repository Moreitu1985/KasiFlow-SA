import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { handleFormError } from '@/lib/forms'
import { OPPORTUNITY_TYPES, entries } from '@/lib/labels'
import { nullIfEmpty, optionalDate, optionalText, requiredText } from '@/lib/validation'
import type { OpportunityType } from '@/types/api'
import { useCreateOpportunity } from './api'

const typeKeys = Object.keys(OPPORTUNITY_TYPES) as [OpportunityType, ...OpportunityType[]]
const schema = z.object({
  title: requiredText('Title', 200),
  organisation: requiredText('Organisation', 200),
  opportunityType: z.enum(typeKeys),
  description: requiredText('Description', 4000),
  industry: optionalText(120),
  eligibilityCriteria: optionalText(4000),
  requiredDocuments: optionalText(4000),
  applicationDeadline: optionalDate,
  sourceUrl: z.string().trim().refine((v) => v === '' || /^https?:\/\/\S+\.\S+/.test(v), 'Enter a full link starting with https://'),
  geographicScope: optionalText(200),
})
type Values = z.infer<typeof schema>

export function AddOpportunityDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; onCreated: (id: string) => void }) {
  const create = useCreateOpportunity()
  const { register, handleSubmit, formState, reset, setError } = useForm<Values>({ resolver: zodResolver(schema) })
  useEffect(() => {
    if (open)
      reset({ title: '', organisation: '', opportunityType: 'funding', description: '', industry: '', eligibilityCriteria: '', requiredDocuments: '', applicationDeadline: '', sourceUrl: '', geographicScope: '' })
  }, [open, reset])
  const e = formState.errors

  const submit = handleSubmit(async (v) => {
    try {
      const o = await create.mutateAsync({
        title: v.title.trim(),
        organisation: v.organisation.trim(),
        opportunityType: v.opportunityType,
        description: v.description.trim(),
        industry: nullIfEmpty(v.industry),
        eligibilityCriteria: nullIfEmpty(v.eligibilityCriteria),
        requiredDocuments: v.requiredDocuments.split('\n').map((s) => s.trim()).filter(Boolean),
        applicationDeadline: nullIfEmpty(v.applicationDeadline),
        sourceUrl: nullIfEmpty(v.sourceUrl),
        geographicScope: nullIfEmpty(v.geographicScope),
      })
      toast.success('Opportunity added', { description: 'Marked “requires verification” until you confirm it.' })
      onOpenChange(false)
      onCreated(o.id)
    } catch (err) {
      handleFormError(err, setError)
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>Add an opportunity</DialogTitle>
            <DialogDescription>Something you heard about — a tender, training or funding programme. Only your business sees it, and it is marked “requires verification”.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Field id="o-title" label="Title" error={e.title?.message}>
              <Input {...register('title')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="o-org" label="Organisation" error={e.organisation?.message}>
                <Input {...register('organisation')} />
              </Field>
              <Field id="o-type" label="Type" error={e.opportunityType?.message}>
                <NativeSelect {...register('opportunityType')}>
                  {entries(OPPORTUNITY_TYPES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field id="o-desc" label="Description" error={e.description?.message}>
              <Textarea rows={3} {...register('description')} />
            </Field>
            <Field id="o-elig" label="Who can apply" optional error={e.eligibilityCriteria?.message}>
              <Textarea rows={2} {...register('eligibilityCriteria')} />
            </Field>
            <Field id="o-docs" label="Documents needed" optional hint="One per line." error={e.requiredDocuments?.message}>
              <Textarea rows={3} {...register('requiredDocuments')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="o-deadline" label="Deadline" optional error={e.applicationDeadline?.message}>
                <Input type="date" {...register('applicationDeadline')} />
              </Field>
              <Field id="o-industry" label="Industry" optional error={e.industry?.message}>
                <Input {...register('industry')} />
              </Field>
              <Field id="o-scope" label="Area" optional hint="e.g. Gauteng, National" error={e.geographicScope?.message}>
                <Input {...register('geographicScope')} />
              </Field>
              <Field id="o-url" label="Official link" optional error={e.sourceUrl?.message}>
                <Input type="url" placeholder="https://" {...register('sourceUrl')} />
              </Field>
            </div>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={formState.isSubmitting}>
              Add opportunity
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
