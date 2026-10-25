import { useEffect, useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/input'
import { errorMessage } from '@/lib/apiClient'
import { cn } from '@/lib/utils'

/** A checklist card with a completion checkbox and private notes. Used by registration and funding readiness. */
export function ChecklistItem({
  id,
  index,
  title,
  completed,
  notes,
  locked,
  lockedReason,
  badges,
  children,
  onSave,
}: {
  id: string
  index?: number
  title: string
  completed: boolean
  notes: string | null
  locked?: boolean
  lockedReason?: string
  badges?: ReactNode
  children?: ReactNode
  onSave: (completed: boolean, notes: string | null) => Promise<unknown>
}) {
  const [draft, setDraft] = useState(notes ?? '')
  const [busy, setBusy] = useState(false)
  useEffect(() => setDraft(notes ?? ''), [notes])
  const dirty = (notes ?? '') !== draft

  const save = async (nextCompleted: boolean, nextNotes: string) => {
    setBusy(true)
    try {
      await onSave(nextCompleted, nextNotes.trim() === '' ? null : nextNotes.trim())
      toast.success(nextCompleted !== completed ? (nextCompleted ? 'Marked as done' : 'Marked as not done') : 'Notes saved')
    } catch (err) {
      toast.error('Could not save', { description: errorMessage(err) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={cn('rounded-lg border bg-surface shadow-card', completed ? 'border-emerald-200' : 'border-line')}>
      <div className="flex gap-3 p-4 sm:p-5">
        <div className="pt-0.5">
          <button
            type="button"
            role="checkbox"
            aria-checked={completed}
            aria-label={`${title}: ${completed ? 'done' : 'not done'}`}
            disabled={locked || busy}
            title={locked ? lockedReason : undefined}
            onClick={() => save(!completed, draft)}
            className={cn(
              'flex size-7 cursor-pointer items-center justify-center rounded-full border-2 transition-colors disabled:cursor-not-allowed',
              completed ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-line-strong bg-surface text-ink-muted hover:border-forest-700',
            )}
          >
            {completed ? <Check className="size-4" aria-hidden /> : index !== undefined ? <span className="text-xs font-bold">{index}</span> : null}
          </button>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={cn('font-sans text-[15px] font-semibold', completed && 'text-ink-soft')}>{title}</h3>
            {badges}
          </div>
          {children}
          <details className="mt-3 group">
            <summary className="cursor-pointer text-[13px] font-semibold text-forest-800 hover:underline">{notes ? 'Your notes' : 'Add notes'}</summary>
            <div className="mt-2 flex flex-col gap-2">
              <label htmlFor={`notes-${id}`} className="sr-only">
                Notes for {title}
              </label>
              <Textarea id={`notes-${id}`} rows={2} value={draft} maxLength={2000} onChange={(e) => setDraft(e.target.value)} />
              <Button size="sm" variant="secondary" className="self-start" disabled={!dirty} loading={busy} onClick={() => save(completed, draft)}>
                Save notes
              </Button>
            </div>
          </details>
        </div>
      </div>
    </article>
  )
}
