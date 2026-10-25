import { useState } from 'react'
import { toast } from 'sonner'
import { CircleCheck, CircleDashed, Clock, LifeBuoy, MapPin, Phone, ShieldAlert, ShieldCheck, UserRound } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Checkbox, Textarea } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/shared/States'
import { ApiError, errorMessage } from '@/lib/apiClient'
import { formatDateTime } from '@/lib/format'
import { formatTime } from '@/lib/barbershop'
import { safetyActionLabel, stageActions, stageProgress } from '@/lib/customer'
import { cn } from '@/lib/utils'
import type { HouseCallSafetyDto, SafetyCheckinKind } from '@/types/customer'
import { useCheckIn, useSafety } from './api'
import { VisitMap } from '@/features/map/VisitMap'

const STEPS: SafetyCheckinKind[] = ['departed', 'arrived', 'finished', 'returned']

interface Position {
  latitude: number
  longitude: number
  accuracyM: number
}

/** Asks the browser for the position ONCE, for this check-in only. Never watches the position. */
function positionOnce(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('unsupported'))
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve({
          latitude: Math.round(p.coords.latitude * 1e6) / 1e6,
          longitude: Math.round(p.coords.longitude * 1e6) / 1e6,
          accuracyM: Math.min(100000, Math.round(p.coords.accuracy)),
        }),
      reject,
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    )
  })
}

/** Turns SAPS 10111 and 112 in the API's advice text into tap-to-call links. */
function EmergencyAdvice({ text }: { text: string }) {
  const parts = text.split(/(10111|112)/)
  return (
    <p className="text-[13px] leading-relaxed text-ink-soft">
      {parts.map((p, i) =>
        p === '10111' || p === '112' ? (
          <a key={i} href={`tel:${p}`} className="font-bold text-red-800 underline">
            {p}
          </a>
        ) : (
          <span key={i}>{p}</span>
        ),
      )}
    </p>
  )
}

function Stepper({ stage }: { stage: string }) {
  const done = stageProgress(stage)
  return (
    <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label="Visit check-ins">
      {STEPS.map((k, i) => {
        const ok = i < done
        return (
          <li
            key={k}
            className={cn('flex items-center gap-1.5 rounded-md border px-2 py-1.5 text-[13px] font-medium', ok ? 'border-emerald-200 bg-emerald-50 text-emerald-900' : 'border-line bg-surface text-ink-muted')}
          >
            {ok ? <CircleCheck className="size-4 shrink-0" aria-hidden /> : <CircleDashed className="size-4 shrink-0" aria-hidden />}
            <span>
              {safetyActionLabel(k)}
              <span className="sr-only">{ok ? ' (done)' : ' (not yet)'}</span>
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function Body({ s, bookingId, address }: { s: HouseCallSafetyDto; bookingId: string; address?: { lat: number; lng: number } | null }) {
  const check = useCheckIn(bookingId)
  const [share, setShare] = useState(false)
  const [note, setNote] = useState('')
  const [noteError, setNoteError] = useState<string>()
  const [helpOpen, setHelpOpen] = useState(false)
  const [locating, setLocating] = useState<SafetyCheckinKind | null>(null)
  const steps = stageActions(s.nextActions)
  const canHelp = s.nextActions.includes('help')
  const canClear = s.nextActions.includes('all_clear')
  const onBehalf = !s.isAssignedBarber
  const busy = check.isPending || locating !== null
  const shared = s.timeline
    .filter((t) => t.latitude != null && t.longitude != null)
    .map((t) => ({ id: t.id, lat: t.latitude!, lng: t.longitude!, label: `${t.byName}: ${t.label}`, at: t.at }))

  const send = async (kind: SafetyCheckinKind) => {
    setNoteError(undefined)
    if (onBehalf && kind !== 'all_clear' && note.trim().length < 3) {
      setNoteError('You are recording this for the barber: say how you know (for example “Phoned them, they arrived at 10:05”).')
      return false
    }
    let pos: Position | null = null
    if (share) {
      setLocating(kind)
      try {
        pos = await positionOnce()
      } catch {
        toast.warning('Your location could not be read', { description: 'The check-in is sent without it.' })
      } finally {
        setLocating(null)
      }
    }
    try {
      await check.mutateAsync({ kind, note: note.trim() || null, latitude: pos?.latitude ?? null, longitude: pos?.longitude ?? null, accuracyM: pos?.accuracyM ?? null })
      toast.success(kind === 'help' ? 'Help request recorded — your managers see it now' : `Checked in: ${safetyActionLabel(kind)}`)
      setNote('')
      setShare(false)
      return true
    } catch (e) {
      if (e instanceof ApiError && e.fieldError('note')) setNoteError(e.fieldError('note'))
      else toast.error('Could not record the check-in', { description: errorMessage(e) })
      return false
    }
  }

  return (
    <CardContent className="space-y-4">
      {s.helpActive && (
        <div role="alert" className="space-y-2 rounded-lg border-2 border-red-600 bg-red-50 p-3 text-red-950">
          <p className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="size-5 shrink-0 text-red-700" aria-hidden /> Help requested
          </p>
          <p className="text-sm">Phone the barber now. If they cannot be reached or are in danger, call SAPS on 10111 or 112.</p>
          {s.canCheckIn && canClear && (
            <Button size="lg" className="h-12 w-full bg-emerald-700 hover:bg-emerald-800" loading={check.isPending && check.variables?.kind === 'all_clear'} disabled={busy} onClick={() => void send('all_clear')}>
              <ShieldCheck /> All clear — I am safe
            </Button>
          )}
        </div>
      )}
      {!s.helpActive && s.overdue && (
        <div role="alert" className="rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="flex items-center gap-2 font-semibold">
            <Clock className="size-4 shrink-0 text-amber-700" aria-hidden /> Check-in is late
          </p>
          <p className="mt-0.5">{s.overdueReason ?? 'An expected check-in has not come in.'} This is a prompt to phone the barber, not proof that something is wrong.</p>
        </div>
      )}
      {!s.overdue && s.checkBy && !s.helpActive && (
        <p className="flex items-start gap-1.5 text-sm text-ink-soft">
          <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            Next check-in expected by <strong className="text-ink">{formatTime(s.checkBy)}</strong> ({s.graceMinutes} min grace)
          </span>
        </p>
      )}

      <Stepper stage={s.stage} />

      {s.canCheckIn && (steps.length > 0 || canHelp) && (
        <div className="space-y-3">
          {steps.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2">
              {steps.map((k) => (
                <Button key={k} size="lg" className="h-14 text-base" loading={(check.isPending && check.variables?.kind === k) || locating === k} disabled={busy} onClick={() => void send(k)}>
                  {safetyActionLabel(k)}
                </Button>
              ))}
            </div>
          )}
          <label htmlFor={`share-${bookingId}`} className="flex cursor-pointer items-start gap-2.5 rounded-md border border-line p-3 text-sm">
            <Checkbox id={`share-${bookingId}`} className="mt-0.5" checked={share} onChange={(e) => setShare(e.target.checked)} />
            <span>
              <span className="font-medium">Share my location with this check-in</span>
              <span className="block text-[12px] text-ink-muted">
                Only for the next tap. Your phone asks once; the spot is saved with this check-in so your managers can find you. KasiFlow never tracks you in the background.
              </span>
            </span>
          </label>
          <Field
            id={`safety-note-${bookingId}`}
            label={onBehalf ? 'How do you know?' : 'Note'}
            optional={!onBehalf}
            hint={onBehalf ? 'You are not the barber on this visit, so say how you know (for example: “Phoned them, they arrived at 10:05”).' : undefined}
            error={noteError}
          >
            <Textarea rows={2} maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {canHelp && !s.helpActive && (
            <Button size="lg" variant="destructive" className="h-12 w-full" disabled={busy} onClick={() => setHelpOpen(true)}>
              <LifeBuoy /> I need help
            </Button>
          )}
        </div>
      )}
      {!s.canCheckIn && <p className="text-[13px] text-ink-muted">Only the barber on this visit or a manager can check in.</p>}

      <div className="rounded-md border border-red-200 bg-red-50/60 p-3">
        <p className="mb-1 text-sm font-semibold text-red-950">In an emergency</p>
        <EmergencyAdvice text={s.emergencyAdvice} />
      </div>

      {(s.barberPhone || s.emergencyContact) && (
        <dl className="grid gap-2 rounded-md bg-paper p-3 text-sm sm:grid-cols-2">
          {s.barberPhone && (
            <div>
              <dt className="text-[12px] text-ink-muted">{s.barberName ? `Barber: ${s.barberName}` : 'Barber'}</dt>
              <dd>
                <a href={`tel:${s.barberPhone.replace(/[^\d+]/g, '')}`} className="inline-flex items-center gap-1.5 font-semibold text-forest-800 hover:underline">
                  <Phone className="size-4" aria-hidden /> {s.barberPhone}
                </a>
              </dd>
            </div>
          )}
          {s.emergencyContact && (
            <div>
              <dt className="text-[12px] text-ink-muted">Barber’s emergency contact</dt>
              <dd className="font-medium [overflow-wrap:anywhere]">{s.emergencyContact}</dd>
            </div>
          )}
        </dl>
      )}

      {shared.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-semibold">Where check-ins were shared</p>
          <VisitMap address={address} shared={shared} height={200} title={`Map of check-ins shared for ${s.reference}`} />
        </div>
      )}

      <div>
        <p className="mb-2 text-sm font-semibold">Check-ins</p>
        {s.timeline.length === 0 ? (
          <p className="text-[13px] text-ink-muted">No check-ins yet.</p>
        ) : (
          <ol className="relative space-y-3 border-l border-line pl-5">
            {s.timeline.map((t) => (
              <li key={t.id} className="relative">
                <span
                  className={cn('absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-white', t.kind === 'help' ? 'bg-red-600' : t.kind === 'all_clear' ? 'bg-emerald-600' : 'bg-forest-700')}
                  aria-hidden
                />
                <p className="text-sm font-medium">
                  {t.label} <span className="font-normal text-ink-muted">· {t.byName}</span>
                </p>
                <p className="text-[12px] text-ink-muted">{formatDateTime(t.at)}</p>
                {t.note && <p className="mt-0.5 text-[13px] text-ink-soft">{t.note}</p>}
                {t.mapUrl && (
                  <a href={t.mapUrl} target="_blank" rel="noopener noreferrer" className="mt-0.5 inline-flex items-center gap-1 text-[13px] font-semibold text-forest-800 hover:underline">
                    <MapPin className="size-3.5" aria-hidden /> Shared location{t.accuracyM != null ? ` (about ${t.accuracyM} m)` : ''} — open map
                  </a>
                )}
              </li>
            ))}
          </ol>
        )}
      </div>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ask for help now?</DialogTitle>
            <DialogDescription>Your managers see an urgent alert in KasiFlow straight away.</DialogDescription>
          </DialogHeader>
          <DialogBody className="space-y-3 text-sm">
            <p className="rounded-md bg-red-50 px-3 py-2 text-red-950">
              KasiFlow does not phone, SMS or alert the police for you. If you are in danger, call{' '}
              <a href="tel:10111" className="font-bold underline">
                SAPS 10111
              </a>{' '}
              or{' '}
              <a href="tel:112" className="font-bold underline">
                112
              </a>{' '}
              from your phone now.
            </p>
            <label htmlFor={`share-help-${bookingId}`} className="flex cursor-pointer items-start gap-2.5">
              <Checkbox id={`share-help-${bookingId}`} className="mt-0.5" checked={share} onChange={(e) => setShare(e.target.checked)} />
              <span>Share my location with this help request (only this once)</span>
            </label>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setHelpOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              loading={(check.isPending && check.variables?.kind === 'help') || locating === 'help'}
              onClick={async () => {
                if (await send('help')) setHelpOpen(false)
              }}
            >
              <LifeBuoy /> Yes, I need help
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </CardContent>
  )
}

/** House-call safety: check-ins (left, arrived, finished, back safely), "I need help", and the record managers watch. */
export function SafetyPanel({ bookingId, title, className, address }: { bookingId: string; title?: string; className?: string; address?: { lat: number; lng: number } | null }) {
  const q = useSafety(bookingId)
  const s = q.data
  return (
    <Card className={cn('min-w-0', s?.helpActive && 'border-red-600', className)}>
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <ShieldCheck className="size-5 text-forest-800" aria-hidden /> {title ?? 'Barber safety'}
          {s && (
            <Badge variant={s.helpActive ? 'critical' : s.overdue ? 'warning' : s.stage === 'returned' ? 'success' : 'neutral'}>
              {s.helpActive ? 'Help requested' : s.overdue ? 'Check-in late' : s.stageLabel}
            </Badge>
          )}
        </CardTitle>
        <CardDescription className="flex items-center gap-1.5">
          {s?.barberName && <UserRound className="size-3.5" aria-hidden />}
          {s?.barberName ? `${s.barberName} · ` : ''}Check in when you leave, arrive, finish and get back.
        </CardDescription>
      </CardHeader>
      {q.isLoading ? (
        <CardContent>
          <Skeleton className="h-40" />
        </CardContent>
      ) : q.isError ? (
        <CardContent>
          <ErrorState error={q.error} onRetry={() => q.refetch()} title="Could not load safety check-ins" />
        </CardContent>
      ) : s ? (
        <Body s={s} bookingId={bookingId} address={address} />
      ) : null}
    </Card>
  )
}
