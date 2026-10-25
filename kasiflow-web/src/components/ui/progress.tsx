import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '@/lib/utils'

export function Progress({ value, className, label }: { value: number; className?: string; label: string }) {
  const v = Math.max(0, Math.min(100, value))
  return (
    <ProgressPrimitive.Root
      value={v}
      aria-label={label}
      className={cn('relative h-2 w-full overflow-hidden rounded-full bg-forest-100', className)}
    >
      <ProgressPrimitive.Indicator
        className="h-full bg-forest-800 transition-transform duration-500"
        style={{ transform: `translateX(-${100 - v}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}
