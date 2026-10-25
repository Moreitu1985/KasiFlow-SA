import { z } from 'zod'
import { parseRandToCents, todayJhb } from './format'

export const requiredText = (label: string, max = 200) =>
  z.string().trim().min(1, `${label} is required.`).max(max, `${label} must be ${max} characters or fewer.`)

export const optionalText = (max = 1000) => z.string().trim().max(max, `Keep this under ${max} characters.`)

export const dateString = (label = 'Date') => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} is required.`)

export const optionalDate = z.string().regex(/^(\d{4}-\d{2}-\d{2})?$/, 'Use a valid date.')

/** A rand amount field (string) that must parse to > 0 cents. */
export const randAmount = (label = 'Amount') =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .refine((v) => parseRandToCents(v) !== null, 'Enter an amount like 1500 or 1500.50.')
    .refine((v) => (parseRandToCents(v) ?? 0) > 0, `${label} must be more than R0.00.`)

export const optionalRand = (opts: { allowNegative?: boolean } = {}) =>
  z
    .string()
    .trim()
    .refine((v) => v === '' || parseRandToCents(v, opts) !== null, 'Enter an amount like 1500 or 1500.50.')

export const optionalEmail = z.string().trim().refine((v) => v === '' || z.email().safeParse(v).success, 'Enter a valid email address.')

export const optionalPhone = z
  .string()
  .trim()
  .refine((v) => v === '' || /^[+\d][\d\s()-]{6,19}$/.test(v), 'Enter a valid phone number, e.g. 071 234 5678.')

export const notFuture = (v: string) => v <= todayJhb()

/** Empty string -> null, for optional API fields. */
export const nullIfEmpty = (v: string | undefined | null): string | null => {
  const t = (v ?? '').trim()
  return t === '' ? null : t
}
