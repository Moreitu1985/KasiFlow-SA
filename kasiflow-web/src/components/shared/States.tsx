import type { ReactNode } from 'react'
import { AlertTriangle, RefreshCw, type LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { errorMessage } from '@/lib/apiClient'
import { cn } from '@/lib/utils'

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        'animate-pop-in flex flex-col items-center justify-center rounded-2xl border border-dashed border-line-strong bg-surface/70 px-6 py-10 text-center',
        className,
      )}
    >
      <div className="relative mb-4">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-tint-strong text-heading ring-4 ring-tint" aria-hidden>
          <Icon className="size-6" />
        </div>
        <span className="pole-stripes absolute -right-1.5 -bottom-1.5 h-5 w-2 rounded-full ring-2 ring-surface" aria-hidden />
      </div>
      <h3 className="font-display text-lg font-bold">{title}</h3>
      {description && <p className="mt-1 max-w-md text-sm leading-relaxed text-ink-muted">{description}</p>}
      {action && <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  )
}

export function ErrorState({
  error,
  onRetry,
  title = 'This section could not load',
  className,
}: {
  error: unknown
  onRetry?: () => void
  title?: string
  className?: string
}) {
  return (
    <div
      role="alert"
      className={cn('flex flex-col items-start gap-3 rounded-lg border border-red-200 bg-red-50/70 p-5 sm:flex-row sm:items-center', className)}
    >
      <AlertTriangle className="size-5 shrink-0 text-red-700" aria-hidden />
      <div className="flex-1">
        <p className="text-sm font-semibold text-red-900">{title}</p>
        <p className="text-sm text-red-800">{errorMessage(error)}</p>
      </div>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw /> Try again
        </Button>
      )}
    </div>
  )
}

export function CardsSkeleton({ count = 4, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid gap-4 sm:grid-cols-2 xl:grid-cols-4', className)} aria-busy aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-5">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="mt-3 h-7 w-32" />
          <Skeleton className="mt-3 h-3 w-40" />
        </div>
      ))}
    </div>
  )
}

export function ListSkeleton({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('divide-y divide-line rounded-lg border border-line bg-surface', className)} aria-busy aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-4">
          <Skeleton className="size-9 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="h-4 w-20" />
        </div>
      ))}
    </div>
  )
}

export function ChartSkeleton({ className }: { className?: string }) {
  return <Skeleton className={cn('h-64 w-full', className)} />
}
