import { Link } from 'react-router-dom'
import { Badge } from '@/components/ui/badge'
import { Money } from '@/components/shared/Money'
import { formatDate } from '@/lib/format'
import { PAYMENT_METHODS } from '@/lib/labels'
import type { PaymentRecordDto } from '@/types/api'

export function PaymentHistory({ payments }: { payments: PaymentRecordDto[] }) {
  if (payments.length === 0) return <p className="text-sm text-ink-muted">No payments recorded yet.</p>
  return (
    <ul className="divide-y divide-line">
      {payments.map((p) => (
        <li key={p.id} className="flex items-center gap-3 py-2.5">
          <div className="min-w-0 flex-1">
            <p className={`text-sm font-medium ${p.isVoided ? 'text-ink-muted line-through' : ''}`}>
              {formatDate(p.paymentDate)} · {PAYMENT_METHODS[p.paymentMethod]}
            </p>
            <p className="text-[13px] text-ink-muted">
              {p.reference ? `Ref ${p.reference} · ` : ''}
              <Link to={`/transactions/${p.transactionId}`} className="font-medium text-forest-800 hover:underline">
                View transaction
              </Link>
            </p>
          </div>
          {p.isVoided && <Badge variant="neutral">Voided</Badge>}
          <Money cents={p.amountCents} className={`text-sm font-semibold ${p.isVoided ? 'line-through opacity-60' : ''}`} />
        </li>
      ))}
    </ul>
  )
}
