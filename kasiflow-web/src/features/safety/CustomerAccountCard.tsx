import { useState } from 'react'
import { toast } from 'sonner'
import { Ban, BadgeCheck, NotebookPen, Phone, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field } from '@/components/ui/field'
import { NativeSelect, Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ReasonDialog } from '@/components/shared/ReasonDialog'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDate, formatDateTime } from '@/lib/format'
import { SAFETY_NOTE_CATEGORIES, safetyNoteCategoryLabel } from '@/lib/customer'
import type { SafetyNoteCategory } from '@/types/customer'
import { useAddSafetyNote, useBookingCustomerAccount, useHouseCallBlock } from './api'

function AddNote({ bookingId }: { bookingId: string }) {
  const add = useAddSafetyNote(bookingId)
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<SafetyNoteCategory>('access')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string>()
  if (!open)
    return (
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
        <NotebookPen /> Add note
      </Button>
    )
  return (
    <form
      className="space-y-3 rounded-md border border-line p-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        const n = note.trim()
        if (n.length < 3) return setError('Write at least 3 characters.')
        setError(undefined)
        add.mutate(
          { category, note: n },
          {
            onSuccess: () => {
              toast.success('Note saved')
              setNote('')
              setOpen(false)
            },
            onError: (err) => {
              if (err instanceof ApiError && (err.fieldError('note') || err.fieldError('category'))) setError(err.fieldError('note') ?? err.fieldError('category'))
              else toast.error('Could not save the note', { description: errorMessage(err) })
            },
          },
        )
      }}
    >
      <Field id={`sn-cat-${bookingId}`} label="Kind of note">
        <NativeSelect value={category} onChange={(e) => setCategory(e.target.value as SafetyNoteCategory)}>
          {Object.entries(SAFETY_NOTE_CATEGORIES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <Field id={`sn-note-${bookingId}`} label="Note" hint="Write what happened or what the next barber should know. Facts, not opinions." error={error}>
        <Textarea rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Dog in the yard, ask them to tie it up first" />
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" size="sm" loading={add.isPending}>
          Save note
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </form>
  )
}

/**
 * The verified customer account behind a booking (one-time-code sign-in): history with this shop, safety notes the
 * team keeps, and blocking house calls for this account. Wording stays factual: counts and notes, no labels.
 */
export function CustomerAccountCard({ bookingId, canAddNote }: { bookingId: string; canAddNote: boolean }) {
  const q = useBookingCustomerAccount(bookingId)
  const block = useHouseCallBlock()
  const [dialog, setDialog] = useState<'block' | 'lift' | null>(null)
  if (q.error instanceof ApiError && q.error.status === 404) return null
  const c = q.data

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldCheck className="size-5 text-forest-800" aria-hidden /> Customer account
        </CardTitle>
        <CardDescription>Booked by a customer who verified their contact with a one-time code.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {q.isLoading ? (
          <Skeleton className="h-32" />
        ) : q.isError ? (
          <p className="text-red-800">{errorMessage(q.error)}</p>
        ) : c ? (
          <>
            <div className="space-y-1 [overflow-wrap:anywhere]">
              <p className="font-semibold">{c.fullName ?? 'Name not given'}</p>
              {c.verifiedContact && (
                <p className="inline-flex items-center gap-1.5 text-ink-soft">
                  <BadgeCheck className="size-4 shrink-0 text-emerald-700" aria-hidden /> {c.verifiedContact} <span className="text-[12px] text-ink-muted">(verified)</span>
                </p>
              )}
              {c.contactPhone && (
                <p>
                  <a href={`tel:${c.contactPhone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 font-medium text-forest-800 hover:underline">
                    <Phone className="size-4" aria-hidden /> {c.contactPhone}
                  </a>
                </p>
              )}
              {c.memberSince && <p className="text-[12px] text-ink-muted">Customer account since {formatDate(c.memberSince)}</p>}
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {(
                [
                  ['Visits', c.visitsWithUs],
                  ['No-shows', c.noShowsWithUs],
                  ['Cancelled by them', c.cancelledByCustomer],
                ] as const
              ).map(([label, n]) => (
                <div key={label} className="flex flex-col-reverse rounded-md bg-paper px-1 py-2">
                  <dt className="text-[11px] leading-tight text-ink-muted">{label}</dt>
                  <dd className="font-display text-xl font-semibold tabular">{n}</dd>
                </div>
              ))}
            </dl>
            <p className="-mt-2 text-[11px] text-ink-muted">Counts are for bookings with this shop only.</p>

            {c.houseCallsBlocked && (
              <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-amber-950">
                <p className="flex items-center gap-1.5 font-semibold">
                  <Ban className="size-4 shrink-0" aria-hidden /> House calls blocked for this account
                </p>
                {c.blockReason && <p className="mt-0.5 text-[13px]">Reason: {c.blockReason}</p>}
                <p className="mt-0.5 text-[12px]">They can still book visits at the shop.</p>
              </div>
            )}

            <div>
              <p className="mb-1.5 font-semibold">Safety notes</p>
              {c.safetyNotes.length === 0 ? (
                <p className="text-[13px] text-ink-muted">No notes yet.</p>
              ) : (
                <ul className="divide-y divide-line rounded-md border border-line">
                  {c.safetyNotes.map((n) => (
                    <li key={n.id} className="px-3 py-2">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <Badge variant={n.category === 'safety_concern' ? 'warning' : 'neutral'}>{safetyNoteCategoryLabel(n.category)}</Badge>
                        {n.bookingReference && <span className="font-mono text-[12px] text-ink-muted">{n.bookingReference}</span>}
                      </p>
                      <p className="mt-1 [overflow-wrap:anywhere]">{n.note}</p>
                      <p className="text-[12px] text-ink-muted">
                        {n.authorName} · {formatDateTime(n.at)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {canAddNote && <AddNote bookingId={bookingId} />}
              {c.canBlock &&
                (c.houseCallsBlocked ? (
                  <Button size="sm" variant="outline" onClick={() => setDialog('lift')}>
                    Lift house-call block
                  </Button>
                ) : (
                  <Button size="sm" variant="ghost" className="text-red-700 hover:text-red-800" onClick={() => setDialog('block')}>
                    <Ban /> Block house calls
                  </Button>
                ))}
            </div>
          </>
        ) : null}
      </CardContent>
      {c && (
        <ReasonDialog
          open={dialog !== null}
          onOpenChange={(o) => !o && setDialog(null)}
          title={dialog === 'block' ? 'Block house calls for this customer?' : 'Lift the house-call block?'}
          description={
            dialog === 'block'
              ? 'They can still book visits at the shop. When they try to book a house call they see a neutral message. Write the reason as facts — it is kept with the account.'
              : 'They will be able to book house calls with this shop again.'
          }
          confirmLabel={dialog === 'block' ? 'Block house calls' : 'Lift block'}
          reasonLabel="Reason"
          pending={block.isPending}
          onConfirm={(reason) =>
            block.mutate(
              { userId: c.userId, block: dialog === 'block', reason },
              {
                onSuccess: () => {
                  toast.success(dialog === 'block' ? 'House calls blocked for this account' : 'House-call block lifted')
                  setDialog(null)
                },
                onError: (e) => toast.error('Could not update', { description: errorMessage(e) }),
              },
            )
          }
        />
      )}
    </Card>
  )
}
