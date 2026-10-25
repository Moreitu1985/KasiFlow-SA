import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input, NativeSelect, Textarea } from '@/components/ui/input'
import { formatDate, formatZAR, todayJhb } from '@/lib/format'
import { handleFormError } from '@/lib/forms'
import { INCIDENT_STATUS, INCIDENT_TYPES, entries } from '@/lib/labels'
import { dateString, nullIfEmpty, optionalText, requiredText } from '@/lib/validation'
import { useTransactions } from '@/features/transactions/api'
import type { FraudIncidentDto, IncidentStatus, IncidentType } from '@/types/api'
import { useSaveIncident } from './api'

const typeKeys = Object.keys(INCIDENT_TYPES) as [IncidentType, ...IncidentType[]]
const statusKeys = Object.keys(INCIDENT_STATUS) as [IncidentStatus, ...IncidentStatus[]]
const schema = z.object({
  incidentType: z.enum(typeKeys),
  description: requiredText('What happened', 4000),
  incidentDate: dateString('Date').refine((v) => v <= todayJhb(), 'Date cannot be in the future.'),
  relatedTransactionId: z.string(),
  status: z.enum(statusKeys),
  actionTaken: optionalText(2000),
  privateNotes: optionalText(4000),
})
type Values = z.infer<typeof schema>

export function IncidentDialog({ open, onOpenChange, incident }: { open: boolean; onOpenChange: (o: boolean) => void; incident?: FraudIncidentDto }) {
  const save = useSaveIncident()
  const recent = useTransactions({ status: 'all', page: 1, pageSize: 50 })
  const { register, handleSubmit, formState, reset, setError } = useForm<Values>({ resolver: zodResolver(schema) })
  useEffect(() => {
    if (open)
      reset({
        incidentType: incident?.incidentType ?? 'suspicious_payment_request',
        description: incident?.description ?? '',
        incidentDate: incident?.incidentDate ?? todayJhb(),
        relatedTransactionId: incident?.relatedTransactionId ?? '',
        status: incident?.status ?? 'open',
        actionTaken: incident?.actionTaken ?? '',
        privateNotes: incident?.privateNotes ?? '',
      })
  }, [open, incident, reset])
  const e = formState.errors
  const txns = recent.data?.items ?? []
  const linkedMissing = incident?.relatedTransactionId && !txns.some((t) => t.id === incident.relatedTransactionId)

  const submit = handleSubmit(async (v) => {
    try {
      await save.mutateAsync({
        id: incident?.id,
        input: {
          incidentType: v.incidentType,
          description: v.description.trim(),
          incidentDate: v.incidentDate,
          relatedTransactionId: nullIfEmpty(v.relatedTransactionId),
          status: v.status,
          actionTaken: nullIfEmpty(v.actionTaken),
          privateNotes: nullIfEmpty(v.privateNotes),
        },
      })
      toast.success(incident ? 'Incident updated' : 'Incident logged')
      onOpenChange(false)
    } catch (err) {
      handleFormError(err, setError)
    }
  })

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent variant="sheet">
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <DialogHeader>
            <DialogTitle>{incident ? 'Update incident' : 'Log a suspicious incident'}</DialogTitle>
            <DialogDescription>Private to your business. Stick to facts — what you saw, when, and what you did.</DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="i-type" label="Type" error={e.incidentType?.message}>
                <NativeSelect {...register('incidentType')}>
                  {entries(INCIDENT_TYPES).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="i-date" label="Date" error={e.incidentDate?.message}>
                <Input type="date" max={todayJhb()} {...register('incidentDate')} />
              </Field>
            </div>
            <Field id="i-desc" label="What happened" error={e.description?.message}>
              <Textarea rows={4} {...register('description')} />
            </Field>
            <Field id="i-txn" label="Related transaction" optional hint="Choose from your 50 most recent transactions." error={e.relatedTransactionId?.message}>
              <NativeSelect {...register('relatedTransactionId')}>
                <option value="">None</option>
                {linkedMissing && <option value={incident.relatedTransactionId!}>Linked transaction (older)</option>}
                {txns.map((t) => (
                  <option key={t.id} value={t.id}>
                    {formatDate(t.transactionDate)} · {t.description} · {formatZAR(t.amountCents)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="i-status" label="Status" error={e.status?.message}>
                <NativeSelect {...register('status')}>
                  {entries(INCIDENT_STATUS).map(([k, l]) => (
                    <option key={k} value={k}>
                      {l}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            <Field id="i-action" label="Action taken" optional hint="e.g. Called the bank's fraud line, blocked the number." error={e.actionTaken?.message}>
              <Textarea rows={2} {...register('actionTaken')} />
            </Field>
            <Field id="i-notes" label="Private notes" optional error={e.privateNotes?.message}>
              <Textarea rows={2} {...register('privateNotes')} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={formState.isSubmitting}>
              {incident ? 'Save changes' : 'Log incident'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
