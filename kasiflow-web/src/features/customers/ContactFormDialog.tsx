import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Checkbox, Input, Textarea } from '@/components/ui/input'
import { handleFormError } from '@/lib/forms'
import { nullIfEmpty, optionalEmail, optionalPhone, optionalText, requiredText } from '@/lib/validation'
import type { ContactInput } from '@/types/api'

const schema = z.object({
  name: requiredText('Name', 120),
  phone: optionalPhone,
  email: optionalEmail,
  notes: optionalText(1000),
  isArchived: z.boolean(),
})
type Values = z.infer<typeof schema>

export interface ContactLike {
  id: string
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  isArchived: boolean
}

/** Add/edit form shared by customers and suppliers. */
export function ContactFormDialog({
  open,
  onOpenChange,
  kind,
  contact,
  onSubmit,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  kind: 'customer' | 'supplier'
  contact?: ContactLike
  onSubmit: (input: ContactInput) => Promise<unknown>
}) {
  const blank: Values = { name: '', phone: '', email: '', notes: '', isArchived: false }
  const { register, handleSubmit, formState, reset, setError } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: blank })
  useEffect(() => {
    if (open)
      reset(
        contact
          ? { name: contact.name, phone: contact.phone ?? '', email: contact.email ?? '', notes: contact.notes ?? '', isArchived: contact.isArchived }
          : blank,
      )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact, reset])
  const e = formState.errors
  const noun = kind === 'customer' ? 'customer' : 'supplier'

  const submit = handleSubmit(async (v) => {
    try {
      await onSubmit({
        name: v.name.trim(),
        phone: nullIfEmpty(v.phone),
        email: nullIfEmpty(v.email),
        notes: nullIfEmpty(v.notes),
        isArchived: v.isArchived,
      })
      onOpenChange(false)
    } catch (err) {
      handleFormError(err, setError, { name: 'name', phone: 'phone', email: 'email', notes: 'notes' })
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{contact ? `Edit ${noun}` : `Add ${noun}`}</DialogTitle>
            <DialogDescription>Contact details are private to your business.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <Field id="c-name" label="Name" error={e.name?.message}>
              <Input autoFocus {...register('name')} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="c-phone" label="Phone" optional error={e.phone?.message}>
                <Input type="tel" {...register('phone')} />
              </Field>
              <Field id="c-email" label="Email" optional error={e.email?.message}>
                <Input type="email" {...register('email')} />
              </Field>
            </div>
            <Field id="c-notes" label="Notes" optional error={e.notes?.message}>
              <Textarea rows={2} {...register('notes')} />
            </Field>
            {contact && (
              <label className="flex items-center gap-2 text-sm">
                <Checkbox {...register('isArchived')} /> Archive this {noun} (hidden from lists, history kept)
              </label>
            )}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={formState.isSubmitting}>
              {contact ? 'Save changes' : `Add ${noun}`}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
