import * as React from 'react'
import { cn } from '@/lib/utils'

export const inputClass =
  'flex h-11 w-full rounded-lg border border-line-strong bg-field px-3 py-2 text-[15px] text-ink placeholder:text-ink-muted/70 transition-colors focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-emerald-brand focus-visible:border-forest-700 disabled:cursor-not-allowed disabled:bg-paper disabled:opacity-70 aria-[invalid=true]:border-red-600'

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input ref={ref} type={type} className={cn(inputClass, className)} {...props} />
  ),
)
Input.displayName = 'Input'

export const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, rows = 3, ...props }, ref) => (
    <textarea ref={ref} rows={rows} className={cn(inputClass, 'h-auto min-h-20 leading-relaxed', className)} {...props} />
  ),
)
Textarea.displayName = 'Textarea'

/** Styled native select: best behaviour on low-end phones and fully accessible. */
const CHEVRON = `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%238a8a93' stroke-width='2'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E")`

/** Native select with a drawn chevron. The chevron is an inline style so class merging can never drop the white background. */
export const NativeSelect = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, style, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(inputClass, 'appearance-none pr-9', className)}
      style={{ backgroundImage: CHEVRON, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 0.6rem center', backgroundSize: '16px', ...style }}
      {...props}
    >
      {children}
    </select>
  ),
)
NativeSelect.displayName = 'NativeSelect'

export const Checkbox = React.forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      type="checkbox"
      className={cn('size-4.5 shrink-0 cursor-pointer rounded border-line-strong accent-forest-800', className)}
      {...props}
    />
  ),
)
Checkbox.displayName = 'Checkbox'
