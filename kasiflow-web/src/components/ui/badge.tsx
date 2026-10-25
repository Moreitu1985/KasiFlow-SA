import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

export const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-semibold whitespace-nowrap [&_svg]:size-3.5',
  {
    variants: {
      variant: {
        neutral: 'border-line bg-paper text-ink-soft',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
        info: 'border-sky-200 bg-sky-50 text-sky-800',
        warning: 'border-amber-300 bg-amber-50 text-amber-800',
        critical: 'border-red-200 bg-red-50 text-red-800',
        forest: 'border-primary bg-primary text-primary-fg',
        outline: 'border-line-strong bg-surface text-ink',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />
}
