import * as React from 'react'
import { cn } from '@/lib/utils'
import { Label } from './label'

interface FieldProps {
  id: string
  label: React.ReactNode
  error?: string
  hint?: React.ReactNode
  optional?: boolean
  className?: string
  children: React.ReactElement<Record<string, unknown>>
}

/** Label + control + hint + error, with aria wiring applied to the child control. */
export function Field({ id, label, error, hint, optional, className, children }: FieldProps) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  const control = React.cloneElement(children, {
    id,
    'aria-invalid': error ? true : undefined,
    'aria-describedby': describedBy,
  })
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={id}>
        {label}
        {optional && <span className="ml-1 font-normal text-ink-muted">(optional)</span>}
      </Label>
      {control}
      {hint && (
        <p id={hintId} className="text-[13px] leading-snug text-ink-muted">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-[13px] font-medium text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
