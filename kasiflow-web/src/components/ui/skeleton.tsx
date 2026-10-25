import { cn } from '@/lib/utils'

/** Placeholder with a soft shimmer (still under prefers-reduced-motion). */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('shimmer rounded-md', className)} />
}
