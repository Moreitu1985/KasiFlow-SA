/**
 * Pure helpers and honest labels for connected-business features (origins, providers, reconciliation, cash-up).
 */
import { formatZAR } from './format'
import type { TransactionOrigin } from '@/types/api'
import type {
  ConnectionStatus,
  HealthState,
  ProviderAvailability,
  ProviderPaymentStatus,
  ReconciliationStatus,
  SandboxScenario,
} from '@/types/automation'

export const ORIGIN_LABELS: Record<TransactionOrigin, string> = {
  staff_recorded: 'Staff-recorded',
  connected_pos: 'Connected POS',
  verified_provider: 'Verified payment provider',
  imported_file: 'Imported file',
  demo_simulation: 'Demo simulation',
}

export function originLabel(origin: string | null | undefined): string {
  if (!origin) return ORIGIN_LABELS.staff_recorded
  return (ORIGIN_LABELS as Record<string, string>)[origin] ?? origin
}

/** Records that came from a payment provider / POS / simulator are owned by Reconciliation, not edited by hand. */
export function isProviderCreated(origin: string | null | undefined): boolean {
  return origin === 'connected_pos' || origin === 'verified_provider' || origin === 'demo_simulation'
}

export const AVAILABILITY_LABELS: Record<ProviderAvailability, string> = {
  available: 'Available',
  planned: 'Planned',
  sandbox_only: 'Sandbox only',
}

export const CATEGORY_LABELS: Record<string, string> = {
  payment: 'Payments',
  pos: 'Point of sale',
  accounting: 'Accounting',
  inventory_device: 'Inventory devices',
  notification: 'Notifications',
}

export const CONNECTION_STATUS_LABELS: Record<ConnectionStatus, string> = {
  connected: 'Connected',
  awaiting_credentials: 'Awaiting credentials',
  pending_setup: 'Setup not finished',
  error: 'Error',
  disconnected: 'Disconnected',
}

/** Badge tone for a connection. Green is reserved for status === 'connected' AND a healthy state. */
export function connectionTone(status: string, health: HealthState | string): 'success' | 'warning' | 'critical' | 'neutral' | 'info' {
  if (status === 'connected') return health === 'healthy' ? 'success' : 'warning'
  if (status === 'error' || health === 'error') return 'critical'
  if (status === 'disconnected') return 'neutral'
  return 'info'
}

export const PAYMENT_STATUS_LABELS: Record<ProviderPaymentStatus, string> = {
  pending: 'Pending — not income yet',
  completed: 'Completed',
  failed: 'Failed',
  reversed: 'Reversed',
}

export const RECON_STATUS_LABELS: Record<ReconciliationStatus, string> = {
  needs_review: 'Needs review',
  unmatched: 'Unmatched',
  auto_matched: 'Auto-matched',
  matched: 'Matched',
  created_sale: 'Sale created',
  ignored: 'Ignored',
}

export function formatConfidence(confidence: number): string {
  if (!Number.isFinite(confidence)) return '—'
  const pct = confidence <= 1 ? confidence * 100 : confidence
  return `${Math.round(pct)}%`
}

export interface ScenarioDef {
  key: SandboxScenario
  label: string
  description: string
  fields: ('amount' | 'reference' | 'method' | 'sku' | 'quantity' | 'fee')[]
}

export const SANDBOX_SCENARIOS: ScenarioDef[] = [
  { key: 'qr_payment', label: 'QR / card payment', description: 'A completed payment arrives from the provider.', fields: ['amount', 'reference', 'method'] },
  { key: 'pos_sale', label: 'POS sale with product', description: 'A card sale with a product line; stock goes down.', fields: ['sku', 'quantity'] },
  { key: 'pending_payment', label: 'Pending payment', description: 'A payment that is not finished. Not counted as income.', fields: ['amount', 'reference', 'method'] },
  { key: 'complete_pending', label: 'Complete the pending payment', description: 'The provider confirms the latest pending payment.', fields: [] },
  { key: 'fail_pending', label: 'Fail the pending payment', description: 'The latest pending payment fails. Nothing is income.', fields: [] },
  { key: 'reverse_payment', label: 'Reverse a payment', description: 'The provider reverses the latest completed payment.', fields: [] },
  { key: 'refund', label: 'Refund', description: 'Refund (part of) the latest completed payment.', fields: ['amount'] },
  { key: 'settlement', label: 'Settlement / payout', description: 'Pay out unsettled completed payments, with fees.', fields: ['fee'] },
  { key: 'duplicate', label: 'Duplicate webhook', description: 'Re-send the same event twice. Duplicates are ignored.', fields: [] },
  { key: 'bad_signature', label: 'Forged signature', description: 'An event with a bad signature. It is rejected.', fields: ['amount'] },
]

/**
 * Non-accusatory cash-up wording. A difference is a fact to check (counting, change given, a missed record),
 * not proof that anyone did something wrong.
 */
export function varianceWording(varianceCents: number | null | undefined): { tone: 'ok' | 'short' | 'over'; title: string; detail: string } {
  if (varianceCents === null || varianceCents === undefined || varianceCents === 0)
    return { tone: 'ok', title: 'Cash balances', detail: 'The counted cash matches what the records expected.' }
  const amount = formatZAR(Math.abs(varianceCents))
  if (varianceCents < 0)
    return {
      tone: 'short',
      title: `${amount} less than expected`,
      detail: 'The till has less cash than the records expected. This is often a counting slip, change given, or a sale or paid-out that was not recorded. Recount and check the records.',
    }
  return {
    tone: 'over',
    title: `${amount} more than expected`,
    detail: 'The till has more cash than the records expected. A sale may not have been recorded yet, or a float top-up was missed. Recount and check the records.',
  }
}

/** A fresh idempotency key per form submission (reused on retry of that same submission). */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return c.randomUUID()
  // Fallback for very old browsers: RFC4122-ish v4 from getRandomValues or Math.random.
  const bytes = new Uint8Array(16)
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(bytes)
  else for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const h = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

/** Full webhook URL from the API base and the relative path the API returns. */
export function webhookUrl(apiBase: string, path: string): string {
  const base = apiBase.replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
}

/** Map links produced by the API (briefing / notifications) onto existing frontend routes. */
/** Notification kind -> what it is about (for icons and screen readers). Unknown kinds fall back to the severity icon. */
export const NOTIFICATION_KINDS: Record<string, string> = {
  booking: 'Booking',
  alert: 'Alert',
  debt: 'Debt',
  cash: 'Cash',
  cashup: 'Cash-up',
  stock: 'Stock',
  integration: 'Integration',
  safety: 'Barber safety',
}

export function appLink(link: string | null | undefined): string | null {
  if (!link) return null
  if (!link.startsWith('/') || link.startsWith('//')) return null
  if (link === '/bills' || link.startsWith('/bills?')) return '/suppliers'
  if (link === '/dashboard') return '/app'
  // Debt links from the API (e.g. dispute notifications) open the debt account page.
  const debt = /^\/customers\/debts\/([^/?#]+)/.exec(link)
  if (debt) return `/debts/${debt[1]}`
  return link
}
