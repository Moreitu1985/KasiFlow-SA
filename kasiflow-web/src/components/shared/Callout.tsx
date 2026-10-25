import type { ReactNode } from 'react'
import { AlertOctagon, AlertTriangle, Info, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

const tones = {
  info: { cls: 'border-sky-200 bg-sky-50/70 text-sky-950', Icon: Info, icon: 'text-sky-700' },
  warning: { cls: 'border-amber-300 bg-amber-50 text-amber-950', Icon: AlertTriangle, icon: 'text-amber-700' },
  critical: { cls: 'border-red-200 bg-red-50 text-red-950', Icon: AlertOctagon, icon: 'text-red-700' },
  neutral: { cls: 'border-line bg-surface text-ink', Icon: ShieldCheck, icon: 'text-forest-800' },
}

export function Callout({
  tone = 'info',
  title,
  children,
  action,
  className,
}: {
  tone?: keyof typeof tones
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}) {
  const t = tones[tone]
  return (
    <div className={cn('flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start', t.cls, className)}>
      <t.Icon className={cn('mt-0.5 size-5 shrink-0', t.icon)} aria-hidden />
      <div className="min-w-0 flex-1 text-sm leading-relaxed [overflow-wrap:anywhere]">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'opacity-90')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}
