import { AlertOctagon, AlertTriangle, BadgeCheck, CircleHelp, FileUp, FlaskConical, Info, MonitorSmartphone, UserPen } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { SEVERITY, TRANSACTION_STATUS, VERIFICATION } from '@/lib/labels'
import { originLabel } from '@/lib/automation'
import { cn } from '@/lib/utils'
import type { Severity, TransactionStatus, VerificationStatus } from '@/types/api'

export function SeverityBadge({ severity }: { severity: Severity }) {
  if (severity === 'critical')
    return (
      <Badge variant="critical">
        <AlertOctagon aria-hidden /> {SEVERITY.critical}
      </Badge>
    )
  if (severity === 'warning')
    return (
      <Badge variant="warning">
        <AlertTriangle aria-hidden /> {SEVERITY.warning}
      </Badge>
    )
  return (
    <Badge variant="info">
      <Info aria-hidden /> {SEVERITY.informational}
    </Badge>
  )
}

export function TxnStatusBadge({ status }: { status: TransactionStatus }) {
  const variant = status === 'posted' ? 'success' : status === 'scheduled' ? 'info' : 'neutral'
  return (
    <Badge variant={variant} className={status === 'voided' ? 'line-through decoration-1' : undefined}>
      {TRANSACTION_STATUS[status]}
    </Badge>
  )
}

export function VerificationBadge({ status, large }: { status: VerificationStatus; large?: boolean }) {
  const size = large ? 'px-2.5 py-1 text-[13px]' : ''
  if (status === 'verified_official')
    return (
      <Badge variant="success" className={size}>
        <BadgeCheck aria-hidden /> {VERIFICATION.verified_official}
      </Badge>
    )
  if (status === 'sample')
    return (
      <Badge variant="forest" className={`${size} bg-ochre border-ochre text-forest-950`}>
        <FlaskConical aria-hidden /> SAMPLE — not a live opportunity
      </Badge>
    )
  return (
    <Badge variant="warning" className={size}>
      <CircleHelp aria-hidden /> {VERIFICATION.requires_verification}
    </Badge>
  )
}

/** Where a ledger record came from. Shown on transactions so nobody mistakes simulated or imported data for staff entries. */
export function OriginBadge({ origin, className }: { origin: string | null | undefined; className?: string }) {
  const label = originLabel(origin)
  switch (origin) {
    case 'verified_provider':
      return (
        <Badge variant="success" className={className}>
          <BadgeCheck aria-hidden /> {label}
        </Badge>
      )
    case 'connected_pos':
      return (
        <Badge variant="info" className={className}>
          <MonitorSmartphone aria-hidden /> {label}
        </Badge>
      )
    case 'imported_file':
      return (
        <Badge variant="neutral" className={className}>
          <FileUp aria-hidden /> {label}
        </Badge>
      )
    case 'demo_simulation':
      return (
        <Badge variant="forest" className={cn('border-ochre bg-ochre text-forest-950', className)}>
          <FlaskConical aria-hidden /> {label}
        </Badge>
      )
    default:
      return (
        <Badge variant="outline" className={className}>
          <UserPen aria-hidden /> {label}
        </Badge>
      )
  }
}

/** Persistent label for the fictional demo business. */
export function SandboxBadge({ className }: { className?: string }) {
  return (
    <span
      role="status"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md border border-ochre bg-ochre px-2 py-1 text-[12px] leading-tight font-bold text-forest-950',
        className,
      )}
    >
      <FlaskConical className="size-3.5 shrink-0" aria-hidden />
      <span>
        DEMO · SANDBOX <span className="font-semibold">— simulated data, not real money</span>
      </span>
    </span>
  )
}
