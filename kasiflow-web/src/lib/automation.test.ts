import { describe, expect, it } from 'vitest'
import { canOpenPath, hasAny, isBranchScopedRole, roleLabel } from './access'
import {
  appLink,
  connectionTone,
  formatConfidence,
  isProviderCreated,
  newIdempotencyKey,
  originLabel,
  SANDBOX_SCENARIOS,
  varianceWording,
  webhookUrl,
} from './automation'

const OWNER = ['viewFinancials', 'manageFinancials', 'recordSales', 'manageIntegrations', 'viewIntegrations', 'viewStaff', 'viewInventory']
const CASHIER = ['recordSales', 'operateShift', 'viewInventory', 'recordStockAdjustment', 'viewFraud']
const ACCOUNTANT = ['viewFinancials', 'exportData', 'viewFraud', 'viewIntegrations', 'viewStaff', 'viewPerformance', 'viewInventory', 'viewAudit']

describe('origin labels', () => {
  it.each([
    ['staff_recorded', 'Staff-recorded'],
    ['connected_pos', 'Connected POS'],
    ['verified_provider', 'Verified payment provider'],
    ['imported_file', 'Imported file'],
    ['demo_simulation', 'Demo simulation'],
  ])('maps %s to %s', (origin, label) => {
    expect(originLabel(origin)).toBe(label)
  })

  it('treats a missing origin as staff-recorded and passes unknown values through', () => {
    expect(originLabel(null)).toBe('Staff-recorded')
    expect(originLabel('future_origin')).toBe('future_origin')
  })

  it('marks only provider / POS / simulator records as provider-created', () => {
    expect(isProviderCreated('verified_provider')).toBe(true)
    expect(isProviderCreated('connected_pos')).toBe(true)
    expect(isProviderCreated('demo_simulation')).toBe(true)
    expect(isProviderCreated('staff_recorded')).toBe(false)
    expect(isProviderCreated('imported_file')).toBe(false)
  })
})

describe('access', () => {
  it('can() checks any of the wanted permissions', () => {
    expect(hasAny(OWNER, 'manageIntegrations')).toBe(true)
    expect(hasAny(CASHIER, 'viewFinancials')).toBe(false)
    expect(hasAny(CASHIER, 'viewFinancials', 'recordSales')).toBe(true)
    expect(hasAny(undefined, 'recordSales')).toBe(false)
  })

  it('guards routes by permission', () => {
    expect(canOpenPath(CASHIER, '/growth')).toBe(false)
    expect(canOpenPath(CASHIER, '/transactions')).toBe(true)
    expect(canOpenPath(CASHIER, '/transactions/abc')).toBe(true)
    expect(canOpenPath(CASHIER, '/integrations')).toBe(false)
    expect(canOpenPath(ACCOUNTANT, '/reconciliation')).toBe(true)
    expect(canOpenPath(CASHIER, '/settings')).toBe(true)
  })

  it('keeps business stats and trends for the owner (viewBusinessInsights) only', () => {
    for (const path of ['/app', '/briefing', '/cash-flow', '/reports', '/reports/business-summary', '/growth']) {
      expect(canOpenPath(ACCOUNTANT, path)).toBe(false)
      expect(canOpenPath([...OWNER, 'viewBusinessInsights'], path)).toBe(true)
    }
  })

  it('labels roles and knows which are branch-scoped', () => {
    expect(roleLabel('accountant')).toBe('Accountant / adviser (read-only)')
    expect(isBranchScopedRole('cashier')).toBe(true)
    expect(isBranchScopedRole('business_admin')).toBe(false)
  })
})

describe('varianceWording', () => {
  it('reports a balanced till', () => {
    expect(varianceWording(0).tone).toBe('ok')
    expect(varianceWording(null).tone).toBe('ok')
  })

  it('describes short and over amounts without accusing anyone', () => {
    const short = varianceWording(-2550)
    expect(short.tone).toBe('short')
    expect(short.title).toBe('R25.50 less than expected')
    const over = varianceWording(1000)
    expect(over.tone).toBe('over')
    expect(over.title).toBe('R10.00 more than expected')
    for (const w of [short, over]) expect(w.detail.toLowerCase()).not.toMatch(/theft|stole|fraud|blame/)
  })
})

describe('integration helpers', () => {
  it('only shows green for a connected, healthy connection', () => {
    expect(connectionTone('connected', 'healthy')).toBe('success')
    expect(connectionTone('connected', 'degraded')).toBe('warning')
    expect(connectionTone('awaiting_credentials', 'setup')).toBe('info')
    expect(connectionTone('error', 'error')).toBe('critical')
  })

  it('builds webhook URLs and confidence labels', () => {
    expect(webhookUrl('http://127.0.0.1:5080/', '/api/webhooks/snapscan/x')).toBe('http://127.0.0.1:5080/api/webhooks/snapscan/x')
    expect(formatConfidence(0.7)).toBe('70%')
    expect(formatConfidence(1)).toBe('100%')
  })

  it('covers every sandbox scenario the API accepts', () => {
    expect(SANDBOX_SCENARIOS.map((s) => s.key).sort()).toEqual(
      ['bad_signature', 'complete_pending', 'duplicate', 'fail_pending', 'pending_payment', 'pos_sale', 'qr_payment', 'refund', 'reverse_payment', 'settlement'].sort(),
    )
  })

  it('maps API links to app routes and rejects external links', () => {
    expect(appLink('/bills')).toBe('/suppliers')
    expect(appLink('/debts')).toBe('/debts')
    expect(appLink('/customers/debts/abc-123')).toBe('/debts/abc-123')
    expect(appLink('/bookings/xyz')).toBe('/bookings/xyz')
    expect(appLink('/alerts')).toBe('/alerts')
    expect(appLink('/workspace')).toBe('/workspace')
    expect(appLink('/inventory')).toBe('/inventory')
    expect(appLink('https://evil.example')).toBeNull()
    expect(appLink('//evil.example')).toBeNull()
  })

  it('creates unique idempotency keys', () => {
    const a = newIdempotencyKey()
    expect(a).toMatch(/^[0-9a-f-]{36}$/)
    expect(newIdempotencyKey()).not.toBe(a)
  })
})
