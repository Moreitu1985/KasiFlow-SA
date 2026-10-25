import type { FieldValues, Path, UseFormSetError } from 'react-hook-form'
import { toast } from 'sonner'
import { ApiError, errorMessage } from './apiClient'

/**
 * Map RFC7807 validation errors onto form fields. `fieldMap` maps API field names
 * (e.g. amountCents) to form field names (e.g. amount). Anything unmapped is toasted.
 */
export function handleFormError<T extends FieldValues>(
  err: unknown,
  setError: UseFormSetError<T>,
  fieldMap: Record<string, Path<T>> = {},
  fallbackTitle = 'Could not save',
) {
  if (err instanceof ApiError && Object.keys(err.errors).length > 0) {
    let unmapped: string | undefined
    for (const [apiField, messages] of Object.entries(err.errors)) {
      const formField = fieldMap[apiField] ?? (apiField as Path<T>)
      if (fieldMap[apiField] || Object.values(fieldMap).length === 0) {
        setError(formField, { type: 'server', message: messages[0] })
      } else {
        unmapped ??= messages[0]
      }
    }
    toast.error(fallbackTitle, { description: unmapped ?? 'Check the highlighted fields.' })
    return
  }
  toast.error(fallbackTitle, { description: errorMessage(err) })
}
