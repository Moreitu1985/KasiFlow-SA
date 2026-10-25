import * as React from 'react'
import { inputClass } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** Rand amount input. Value is the raw text the user typed; convert with parseRandToCents. */
export const MoneyInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <div className="relative">
      <span className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-[15px] font-semibold text-ink-muted" aria-hidden>
        R
      </span>
      <input ref={ref} inputMode="decimal" autoComplete="off" placeholder="0.00" className={cn(inputClass, 'pl-7 tabular', className)} {...props} />
    </div>
  ),
)
MoneyInput.displayName = 'MoneyInput'
