import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/input'

/** Confirmation dialog that requires a written reason (void, write-off, cancel). */
export function ReasonDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  reasonLabel = 'Reason',
  onConfirm,
  pending,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: React.ReactNode
  confirmLabel: string
  reasonLabel?: string
  onConfirm: (reason: string) => void
  pending?: boolean
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string>()
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          setReason('')
          setError(undefined)
        }
        onOpenChange(o)
      }}
    >
      <DialogContent>
        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault()
            const r = reason.trim()
            if (r.length < 3) {
              setError('Give a short reason (at least 3 characters).')
              return
            }
            onConfirm(r)
          }}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription asChild>
              <div>{description}</div>
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <Field id="reason" label={reasonLabel} error={error}>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Keep as is
            </Button>
            <Button type="submit" variant="destructive" loading={pending}>
              {confirmLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
