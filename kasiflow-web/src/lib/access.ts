/**
 * Role-based access helpers. They mirror KasiFlow.Core/Access/Permissions.cs so the UI can hide controls a role
 * cannot use. The API is always the authority: a hidden button is a convenience, never a security boundary.
 */

export type Permission =
  | 'viewFinancials'
  | 'manageFinancials'
  | 'recordSales'
  | 'voidTransactions'
  | 'exportData'
  | 'manageSettings'
  | 'viewFraud'
  | 'manageFraud'
  | 'viewIntegrations'
  | 'manageIntegrations'
  | 'manageReconciliation'
  | 'viewStaff'
  | 'manageStaff'
  | 'manageBranches'
  | 'operateShift'
  | 'reviewShifts'
  | 'viewPerformance'
  | 'viewInventory'
  | 'manageInventory'
  | 'recordStockAdjustment'
  | 'approveStockAdjustment'
  | 'viewAudit'
  // Barbershop platform
  | 'viewBookings'
  | 'manageBookings'
  | 'workOwnBookings'
  | 'updateOwnStatus'
  | 'viewTeamStatus'
  | 'manageServices'
  | 'manageStaffSchedules'
  | 'recordExpenses'
  | 'recordDebtPayments'
  | 'configureDebtPolicy'
  | 'viewAlerts'
  | 'manageAlerts'
  | 'verifySupplierBankDetails'
  | 'takeBookingPayments'
  // Owner only: business stats and trends (overview, money summary, reports, forecast, growth engine, staff performance)
  | 'viewBusinessInsights'

export type Role = 'owner' | 'business_admin' | 'branch_manager' | 'cashier' | 'staff' | 'accountant'

export const ROLE_LABELS: Record<Role, string> = {
  owner: 'Owner',
  business_admin: 'Business administrator',
  branch_manager: 'Business manager',
  cashier: 'Cashier / receptionist',
  staff: 'Barber / employee',
  accountant: 'Accountant / adviser (read-only)',
}

export function roleLabel(role: string | null | undefined): string {
  if (!role) return '—'
  return (ROLE_LABELS as Record<string, string>)[role] ?? role
}

export function isBranchScopedRole(role: string): boolean {
  return role === 'branch_manager' || role === 'cashier' || role === 'staff'
}

/** `true` when the permission list contains any of the given permissions. */
export function hasAny(permissions: readonly string[] | null | undefined, ...wanted: Permission[]): boolean {
  if (!permissions || permissions.length === 0) return false
  return wanted.some((p) => permissions.includes(p))
}

export interface AccessInfo {
  role: string
  permissions: readonly string[]
  isDemo: boolean
}

/** Permission(s) needed to open an app route. Any one of the listed permissions is enough. */
export const ROUTE_PERMISSIONS: Record<string, Permission[]> = {
  '/app': ['viewBusinessInsights'],
  '/dashboard': ['viewBusinessInsights'],
  '/briefing': ['viewBusinessInsights'],
  '/floor': ['manageBookings', 'viewBookings', 'manageStaffSchedules'],
  '/workspace': ['updateOwnStatus', 'workOwnBookings', 'viewTeamStatus', 'manageStaffSchedules'],
  '/bookings': ['viewBookings', 'manageBookings', 'workOwnBookings'],
  '/queue': ['manageBookings', 'workOwnBookings'],
  '/earnings': ['workOwnBookings'],
  '/map': ['manageBookings', 'viewBookings'],
  '/payroll': ['viewBusinessInsights'],
  '/insights': ['viewBusinessInsights'],
  '/house-calls': ['viewBookings', 'manageBookings', 'workOwnBookings'],
  '/services': ['manageServices', 'viewBookings', 'manageBookings', 'workOwnBookings'],
  '/payments': ['viewFinancials', 'recordSales', 'recordDebtPayments', 'viewIntegrations'],
  '/debts': ['viewFinancials', 'recordDebtPayments'],
  '/expenses': ['viewFinancials', 'recordExpenses'],
  '/alerts': ['viewAlerts'],
  '/business-profile': ['manageSettings'],
  '/funding': ['viewFinancials', 'manageSettings'],
  '/transactions': ['viewFinancials', 'recordSales'],
  // Must come before '/customers': the first matching key wins. Old debt links redirect to /debts/:id.
  '/customers/debts': ['viewFinancials', 'recordDebtPayments'],
  '/customers': ['viewFinancials'],
  '/suppliers': ['viewFinancials'],
  '/cash-flow': ['viewBusinessInsights'],
  '/growth': ['viewBusinessInsights'],
  '/opportunities': ['viewFinancials', 'manageSettings'],
  '/readiness': ['viewFinancials', 'manageSettings'],
  '/fraud': ['viewFraud'],
  '/reports': ['viewBusinessInsights'],
  '/integrations': ['viewIntegrations'],
  '/reconciliation': ['manageReconciliation', 'viewIntegrations'],
  '/staff': ['viewStaff'],
  '/team/register': ['manageStaff'],
  '/shifts': ['operateShift', 'reviewShifts'],
  '/inventory': ['viewInventory'],
}

/** `true` when the access allows the route (routes not in the table are open to every member). */
export function canOpenPath(permissions: readonly string[], path: string): boolean {
  const key = Object.keys(ROUTE_PERMISSIONS).find((k) => path === k || path.startsWith(`${k}/`))
  if (!key) return true
  return hasAny(permissions, ...ROUTE_PERMISSIONS[key])
}
