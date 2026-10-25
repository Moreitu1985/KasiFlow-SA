import { Link } from 'react-router-dom'
import { ArrowDownLeft, ArrowUpRight, Link2 } from 'lucide-react'
import { Money } from '@/components/shared/Money'
import { OriginBadge, TxnStatusBadge } from '@/components/shared/Badges'
import { Badge } from '@/components/ui/badge'
import { formatDate } from '@/lib/format'
import { PAYMENT_STATUS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import type { TransactionDto } from '@/types/api'

export function TxnIcon({ type }: { type: TransactionDto['type'] }) {
  return (
    <span
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full',
        type === 'income' ? 'bg-emerald-50 text-emerald-800' : 'bg-ochre-soft text-amber-900',
      )}
      aria-hidden
    >
      {type === 'income' ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
    </span>
  )
}

/** Compact list row used on mobile and on the dashboard. */
export function TransactionListItem({ t }: { t: TransactionDto }) {
  return (
    <Link
      to={`/transactions/${t.id}`}
      className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-paper focus-visible:bg-paper"
    >
      <TxnIcon type={t.type} />
      <div className="min-w-0 flex-1">
        <p className={cn('truncate text-sm font-medium', t.status === 'voided' && 'text-ink-muted line-through')}>{t.description}</p>
        <p className="truncate text-[13px] text-ink-muted">
          {formatDate(t.transactionDate)} · {t.category}
          {t.counterpartyName ? ` · ${t.counterpartyName}` : ''}
          {t.branchName ? ` · ${t.branchName}` : ''}
        </p>
      </div>
      <div className="flex flex-col items-end gap-1">
        <Money
          cents={t.type === 'income' ? t.amountCents : -t.amountCents}
          signed
          tone={t.type === 'income' ? 'income' : 'expense'}
          className={cn('text-sm font-semibold', t.status === 'voided' && 'line-through opacity-60')}
        />
        <div className="flex flex-wrap justify-end gap-1">
          {t.origin && t.origin !== 'staff_recorded' && <OriginBadge origin={t.origin} />}
          {t.status !== 'posted' && <TxnStatusBadge status={t.status} />}
          {t.paymentStatus === 'awaiting_confirmation' && t.status !== 'voided' && <Badge variant="warning">{PAYMENT_STATUS.awaiting_confirmation}</Badge>}
          {t.source !== 'manual' && (
            <Badge variant="outline" title="Linked to a debt or bill payment">
              <Link2 aria-hidden /> Linked
            </Badge>
          )}
        </div>
      </div>
    </Link>
  )
}
