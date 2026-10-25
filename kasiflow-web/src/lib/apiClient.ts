import type { ProblemDetails } from '@/types/api'
import { env } from './env'
import { supabase } from './supabase'
import { getActiveBusinessId } from './activeBusiness'

export class ApiError extends Error {
  readonly status: number
  readonly title: string
  readonly detail: string | undefined
  readonly errors: Record<string, string[]>

  constructor(status: number, problem: ProblemDetails | null, fallback: string) {
    const title = problem?.title ?? fallback
    super(problem?.detail ?? title)
    this.name = 'ApiError'
    this.status = status
    this.title = title
    this.detail = problem?.detail
    this.errors = normaliseErrors(problem?.errors)
  }

  /** First validation message for a field (case-insensitive key match). */
  fieldError(field: string): string | undefined {
    const key = Object.keys(this.errors).find((k) => k.toLowerCase() === field.toLowerCase())
    return key ? this.errors[key]?.[0] : undefined
  }

  /** A single human-readable line suitable for a toast. */
  get userMessage(): string {
    if (this.status === 0) return 'Could not reach the KasiFlow server. Check your connection and try again.'
    if (this.status === 429) return 'Too many requests. Wait a moment and try again.'
    const firstField = Object.values(this.errors)[0]?.[0]
    return this.detail ?? firstField ?? this.title
  }
}

function normaliseErrors(errors: unknown): Record<string, string[]> {
  if (!errors || typeof errors !== 'object') return {}
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(errors as Record<string, unknown>)) {
    // ASP.NET may send "$.amountCents" or "AmountCents"; normalise to camelCase leaf name.
    const leaf = k.replace(/^\$\./, '').split('.').pop() ?? k
    const key = leaf.charAt(0).toLowerCase() + leaf.slice(1)
    out[key] = Array.isArray(v) ? v.map(String) : [String(v)]
  }
  return out
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.userMessage
  if (err instanceof Error) return err.message
  return 'Something went wrong.'
}

type Query = Record<string, string | number | boolean | null | undefined>

interface RequestOptions {
  query?: Query
  body?: unknown
  /** Anonymous routes (`/api/public/*`) skip the Authorization and X-Business-Id headers. */
  anonymous?: boolean
  signal?: AbortSignal
  accept?: string
  /** Extra request headers, e.g. `Idempotency-Key`. */
  headers?: Record<string, string>
  /**
   * Customer routes (`/api/customer/*`, creating a public booking): send the signed-in person's token but never the
   * X-Business-Id header — a customer has no business. An expired session goes to the customer sign-in page.
   */
  customer?: boolean
  /** Do not sign out and redirect on 401: the caller shows its own sign-in prompt (e.g. the booking page). */
  soft401?: boolean
}

type SendOptions = Pick<RequestOptions, 'headers' | 'anonymous' | 'customer' | 'soft401'>

export function buildUrl(path: string, query?: Query): string {
  const url = `${env.apiBaseUrl}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [k, v] of Object.entries(query)) {
    if (v === undefined || v === null || v === '') continue
    params.set(k, String(v))
  }
  const qs = params.toString()
  return qs ? `${url}?${qs}` : url
}

let handlingUnauthorized = false

async function handleUnauthorized(signInPath = '/sign-in') {
  if (handlingUnauthorized) return
  handlingUnauthorized = true
  try {
    await supabase?.auth.signOut()
  } finally {
    const next = encodeURIComponent(window.location.pathname + window.location.search)
    window.location.assign(`${signInPath}?expired=1&next=${next}`)
  }
}

async function send(method: string, path: string, opts: RequestOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { ...opts.headers, Accept: opts.accept ?? 'application/json' }
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json'

  if (!opts.anonymous) {
    const session = supabase ? (await supabase.auth.getSession()).data.session : null
    if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`
    const businessId = opts.customer ? null : getActiveBusinessId()
    if (businessId) headers['X-Business-Id'] = businessId
  }

  let res: Response
  try {
    res = await fetch(buildUrl(path, opts.query), {
      method,
      headers,
      body: opts.body === undefined ? undefined : isForm ? (opts.body as FormData) : JSON.stringify(opts.body),
      signal: opts.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new ApiError(0, null, 'Network error')
  }

  if (res.status === 401 && !opts.anonymous) {
    if (!opts.soft401) void handleUnauthorized(opts.customer ? '/c/sign-in' : '/sign-in')
    throw new ApiError(401, null, 'Your session has expired. Please sign in again.')
  }

  if (!res.ok) {
    let problem: ProblemDetails | null = null
    try {
      const text = await res.text()
      problem = text ? (JSON.parse(text) as ProblemDetails) : null
    } catch {
      problem = null
    }
    throw new ApiError(res.status, problem, defaultTitle(res.status))
  }
  return res
}

function defaultTitle(status: number): string {
  switch (status) {
    case 400:
      return 'Some details need fixing.'
    case 404:
      return 'Not found.'
    case 409:
      return 'That change conflicts with the current data.'
    case 429:
      return 'Too many requests.'
    default:
      return status >= 500 ? 'The server had a problem. Try again shortly.' : `Request failed (${status}).`
  }
}

async function json<T>(method: string, path: string, opts?: RequestOptions): Promise<T> {
  const res = await send(method, path, opts)
  if (res.status === 204) return undefined as T
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

export const api = {
  get: <T>(path: string, query?: Query, opts?: Omit<RequestOptions, 'query'>) => json<T>('GET', path, { ...opts, query }),
  post: <T>(path: string, body?: unknown, opts?: SendOptions) => json<T>('POST', path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: SendOptions) => json<T>('PUT', path, { ...opts, body }),
  patch: <T>(path: string, body?: unknown) => json<T>('PATCH', path, { body }),
  delete: <T = void>(path: string, opts?: SendOptions) => json<T>('DELETE', path, opts),

  /** multipart/form-data upload (the browser sets the boundary header). */
  upload: <T>(path: string, form: FormData) => json<T>('POST', path, { body: form }),

  /** Fetch an authenticated file as a Blob (e.g. a proof of payment) so it can be opened in a new tab. */
  async blob(path: string): Promise<Blob> {
    const res = await send('GET', path, { accept: '*/*' })
    return res.blob()
  },

  /** Download a CSV (or any file) and trigger a browser save. */
  async download(path: string, query?: Query, fallbackName = 'export.csv'): Promise<void> {
    const res = await send('GET', path, { query, accept: 'text/csv' })
    const blob = await res.blob()
    const name = filenameFromDisposition(res.headers.get('Content-Disposition')) ?? fallbackName
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  },
}

function filenameFromDisposition(header: string | null): string | null {
  if (!header) return null
  const star = /filename\*=(?:UTF-8'')?([^;]+)/i.exec(header)
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))
    } catch {
      /* fall through */
    }
  }
  const plain = /filename="?([^";]+)"?/i.exec(header)
  return plain ? plain[1].trim() : null
}
