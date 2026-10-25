import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Copy, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/input'
import { formatDate, formatZAR } from '@/lib/format'

/** Convert a South African number to wa.me format (27XXXXXXXXX). Returns null if unsure. */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null
  let d = phone.replace(/[^\d+]/g, '')
  if (d.startsWith('+')) d = d.slice(1)
  else if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0') && d.length === 10) d = `27${d.slice(1)}`
  return /^\d{10,15}$/.test(d) ? d : null
}

export function buildReminder(p: { name: string; business: string; amountCents: number; description: string; dueDate: string | null }) {
  const due = p.dueDate ? `, which was due on ${formatDate(p.dueDate)}` : ''
  return `Hi ${p.name}, this is a friendly reminder from ${p.business} about ${formatZAR(p.amountCents)} for ${p.description}${due}. When you are able to, please let me know when you can settle it — part payments are welcome. Thank you for your support!`
}

export function ReminderDialog({
  open,
  onOpenChange,
  initialText,
  phone,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  initialText: string
  phone: string | null
}) {
  const [text, setText] = useState(initialText)
  useEffect(() => {
    if (open) setText(initialText)
  }, [open, initialText])
  const number = toWhatsAppNumber(phone)
  const href = `https://wa.me/${number ?? ''}?text=${encodeURIComponent(text)}`

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Message copied')
    } catch {
      toast.error('Could not copy', { description: 'Select the text and copy it manually.' })
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Payment reminder</DialogTitle>
          <DialogDescription>
            Edit the message, then copy it or open it in WhatsApp. Nothing is sent automatically — you choose whether and when to send it.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          <Field id="reminder" label="Message" hint="Keep it polite and private. Never shame a customer publicly.">
            <Textarea rows={7} value={text} onChange={(e) => setText(e.target.value)} />
          </Field>
          {!number && <p className="mt-3 text-[13px] text-ink-muted">No valid phone number saved for this customer — WhatsApp will ask you to pick a contact.</p>}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={copy}>
            <Copy /> Copy message
          </Button>
          <Button asChild>
            <a href={href} target="_blank" rel="noopener noreferrer">
              <MessageCircle /> Open in WhatsApp
            </a>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
