import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  /** Shown above the title, e.g. the "whose app is this" badge. */
  eyebrow?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between', className)}>
      <div className="max-w-2xl min-w-0">
        {eyebrow && <div className="mb-2.5">{eyebrow}</div>}
        <h1 className="text-[1.65rem] leading-tight font-bold sm:text-[2rem]">{title}</h1>
        {description && <p className="mt-1.5 text-[15px] leading-relaxed text-ink-soft">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  )
}
