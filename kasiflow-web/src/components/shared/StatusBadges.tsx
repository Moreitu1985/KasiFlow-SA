import { Badge } from '@/components/ui/badge'
import {
  ALERT_STATUS_LABELS,
  bookingStatusLabel,
  bookingStatusTone,
  DEBT_STATUS_LABELS,
  debtStatusTone,
  proofTone,
  staffStatusLabel,
  staffStatusTone,
} from '@/lib/barbershop'
import { cn } from '@/lib/utils'
import type { AlertStatus, DebtStatus } from '@/types/barbershop'

const DOT: Record<string, string> = {
  success: 'bg-emerald-500',
  warning: 'bg-amber-500',
  info: 'bg-sky-500',
  critical: 'bg-red-600',
  neutral: 'bg-ink-muted/60',
}

/** Coloured dot + label for a barber's live status. The label always carries the meaning, not the colour. */
export function StaffStatusBadge({ status, label, stale, className }: { status: string; label?: string; stale?: boolean; className?: string }) {
  const tone = staffStatusTone(status)
  return (
    <Badge variant={tone === 'neutral' ? 'neutral' : tone === 'success' ? 'success' : tone === 'critical' ? 'critical' : tone === 'info' ? 'info' : 'warning'} className={className}>
      <span className={cn('size-2 rounded-full', DOT[tone] ?? DOT.neutral)} aria-hidden />
      {label ?? staffStatusLabel(status)}
      {stale && <span className="font-normal">(not updated)</span>}
    </Badge>
  )
}

export function BookingStatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Badge variant={bookingStatusTone(status)} className={className}>
      {label ?? bookingStatusLabel(status)}
    </Badge>
  )
}

export function DebtStatusBadge({ status, label }: { status: DebtStatus | string; label?: string }) {
  return <Badge variant={debtStatusTone(status)}>{label ?? (DEBT_STATUS_LABELS as Record<string, string>)[status] ?? status}</Badge>
}

export function ProofStatusBadge({ status, label }: { status: string; label: string }) {
  return (
    <Badge variant={proofTone(status)} className="whitespace-normal">
      {label}
    </Badge>
  )
}

export function AlertStatusBadge({ status }: { status: AlertStatus }) {
  const v = status === 'open' ? 'warning' : status === 'under_review' ? 'info' : status === 'resolved' ? 'success' : 'neutral'
  return <Badge variant={v}>{ALERT_STATUS_LABELS[status] ?? status}</Badge>
}
