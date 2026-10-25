/**
 * DTO types for the automation / connected-business API.
 * Source of truth: KasiFlow.Api/DTOs/AutomationDtos.cs (JSON is camelCase, money is integer cents).
 */
import type { DateOnly, Timestamp, Uuid } from './api'

// ---------- Integrations ----------
export type ProviderAvailability = 'available' | 'planned' | 'sandbox_only'
export type ConnectionStatus = 'connected' | 'awaiting_credentials' | 'pending_setup' | 'error' | 'disconnected'
export type HealthState = 'healthy' | 'degraded' | 'setup' | 'error' | 'disconnected'

export interface CapabilityDto {
  key: string
  label: string
  supported: boolean
  note: string | null
}

export interface ProviderCardDto {
  key: string
  name: string
  /** payment | pos | accounting | inventory_device | notification */
  category: string
  availability: ProviderAvailability
  environment: string
  summary: string
  capabilities: CapabilityDto[]
  setupSteps: string[]
  docsUrl: string | null
  notes: string | null
  canConnect: boolean
}

export interface ConnectionHealthDto {
  state: HealthState
  label: string
  eventsLast24h: number
  failedEvents: number
  duplicateEvents: number
  pendingJobs: number
  deadJobs: number
  lastEventAt: Timestamp | null
}

export interface ConnectionDto {
  id: Uuid
  providerKey: string
  environment: string
  status: ConnectionStatus
  displayName: string
  credentialRef: string | null
  defaultBranchId: Uuid | null
  connectedAt: Timestamp | null
  lastTestAt: Timestamp | null
  lastTestOk: boolean | null
  lastSyncAt: Timestamp | null
  lastSuccessAt: Timestamp | null
  lastError: string | null
  lastErrorHint: string | null
  webhookPath: string
  isSandbox: boolean
  health: ConnectionHealthDto
}

export interface IntegrationsOverviewDto {
  catalogue: ProviderCardDto[]
  connections: ConnectionDto[]
  isDemoBusiness: boolean
  canManage: boolean
}

export interface ConnectInput {
  providerKey: string
  displayName?: string | null
  credentialRef?: string | null
  defaultBranchId?: Uuid | null
}

export interface ConnectionTestDto {
  ok: boolean
  status: string
  error: string | null
  hint: string | null
  connection: ConnectionDto
}

export interface ActivityDto {
  kind: string
  id: Uuid | null
  at: Timestamp
  status: string
  summary: string
  detail: string | null
}

export type ProviderPaymentStatus = 'pending' | 'completed' | 'failed' | 'reversed'
export type ReconciliationStatus = 'needs_review' | 'unmatched' | 'auto_matched' | 'matched' | 'created_sale' | 'ignored'

export interface ProviderPaymentDto {
  id: Uuid
  connectionId: Uuid
  connectionName: string
  providerKey: string
  environment: string
  externalPaymentId: string
  kind: 'payment' | 'refund'
  method: string
  status: ProviderPaymentStatus
  grossCents: number
  tipCents: number
  feeCents: number | null
  netCents: number | null
  merchantReference: string | null
  statementReference: string | null
  occurredAt: Timestamp
  completedAt: Timestamp | null
  settlementId: Uuid | null
  transactionId: Uuid | null
  reconciliationStatus: ReconciliationStatus
  branchId: Uuid | null
  countsAsIncome: boolean
  sourceLabel: string
}

export interface SettlementDto {
  id: Uuid
  connectionId: Uuid
  externalSettlementId: string
  settledOn: DateOnly
  grossCents: number
  feeCents: number | null
  netCents: number | null
  paymentCount: number
  feeTransactionId: Uuid | null
  environment: string
}

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'dead'

export interface JobDto {
  id: Uuid
  jobType: string
  status: JobStatus
  attempts: number
  maxAttempts: number
  runAfter: Timestamp
  lastError: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
  completedAt: Timestamp | null
}

export type SandboxScenario =
  | 'qr_payment'
  | 'pos_sale'
  | 'pending_payment'
  | 'complete_pending'
  | 'fail_pending'
  | 'reverse_payment'
  | 'refund'
  | 'settlement'
  | 'duplicate'
  | 'bad_signature'

export interface SimulateInput {
  scenario: SandboxScenario
  amountCents?: number | null
  reference?: string | null
  method?: 'qr' | 'card' | null
  paymentId?: Uuid | null
  feeCents?: number | null
  sku?: string | null
  quantity?: number | null
}

export interface SimulatedDeliveryDto {
  externalEventId: string
  httpStatus: number
  outcome: string
}

export interface SimulateResultDto {
  scenario: string
  message: string
  deliveries: SimulatedDeliveryDto[]
}

export interface SandboxResetDto {
  paymentsRemoved: number
  transactionsRemoved: number
  stockMovementsReversed: number
}

// ---------- Reconciliation ----------
export interface ReconciliationSummaryDto {
  needsReview: number
  unmatched: number
  autoMatched: number
  matched: number
  createdSales: number
  ignored: number
  pendingCents: number
  pendingCount: number
  unsettledCents: number
  settlementsCount: number
}

export interface MatchSuggestionDto {
  id: Uuid
  transactionId: Uuid
  description: string
  amountCents: number
  date: DateOnly
  reference: string | null
  method: string
  /** 0..1 */
  confidence: number
  reason: string
  status: string
}

export interface ReconciliationItemDto {
  payment: ProviderPaymentDto
  suggestions: MatchSuggestionDto[]
}

// ---------- Notifications ----------
export type NotificationSeverity = 'informational' | 'warning' | 'critical'

export interface NotificationDto {
  id: Uuid
  kind: string
  severity: NotificationSeverity
  title: string
  body: string
  link: string | null
  createdAt: Timestamp
  readAt: Timestamp | null
}

export interface NotificationListDto {
  items: NotificationDto[]
  unreadCount: number
}

export interface NotificationPreferencesDto {
  briefingTime: string
  inApp: boolean
  email: boolean
  criticalCash: boolean
  cashup: boolean
  lowStock: boolean
  integrations: boolean
  emailAvailable: boolean
}

export interface BriefingItemDto {
  kind: string
  severity: NotificationSeverity
  title: string
  detail: string
  link: string | null
}

export interface BriefingDto {
  date: DateOnly
  greeting: string
  cashBalanceCents: number
  yesterdayIncomeCents: number
  yesterdayExpensesCents: number
  yesterdaySalesCount: number
  forecast: {
    horizonDays: number
    lowestExpectedBalanceCents: number
    lowestExpectedBalanceDate: DateOnly
    closingExpectedBalanceCents: number
    firstShortageDate: DateOnly | null
    firstBelowBufferDate: DateOnly | null
    isPreliminary: boolean
    preliminaryReason: string | null
    lowestConservativeBalanceCents: number
    lowestOptimisticBalanceCents: number
  } | null // null for roles without financial access
  items: BriefingItemDto[]
  dataNotes: string[]
}

// ---------- Branches & staff ----------
export interface BranchDto {
  id: Uuid
  name: string
  area: string | null
  isActive: boolean
  createdAt: Timestamp
}

export interface BranchInput {
  name: string
  area?: string | null
  isActive?: boolean
}

export interface StaffMemberDto {
  userId: Uuid
  displayName: string | null
  email: string | null
  role: string
  roleLabel: string
  isActive: boolean
  branchIds: Uuid[]
  joinedAt: Timestamp
  isYou: boolean
}

export interface InvitationDto {
  id: Uuid
  email: string
  role: string
  branchIds: Uuid[]
  status: string
  expiresAt: Timestamp
  createdAt: Timestamp
}

export interface RoleInfoDto {
  key: string
  label: string
  branchScoped: boolean
  permissions: string[]
}

export interface StaffOverviewDto {
  members: StaffMemberDto[]
  invitations: InvitationDto[]
  branches: BranchDto[]
  roles: RoleInfoDto[]
}

export interface InvitationInput {
  email: string
  role: string
  branchIds: Uuid[]
}

export interface InvitationCreatedDto {
  invitation: InvitationDto
  token: string
  acceptPath: string
  note: string
}

export interface RoleChangeInput {
  role: string
  branchIds: Uuid[]
}

export interface StaffPerformanceRowDto {
  userId: Uuid
  name: string
  role: string
  salesCount: number
  salesCents: number
  averageSaleCents: number
  voidedCount: number
  shiftsClosed: number
  cashUpsNeedingReview: number
  netCashVarianceCents: number
}

export interface StaffPerformanceDto {
  from: DateOnly
  to: DateOnly
  rows: StaffPerformanceRowDto[]
  caveats: string[]
}

export interface BusinessSummaryForJoinDto {
  businessId: Uuid
  businessName: string
  role: string
  roleLabel: string
}

// ---------- Shifts ----------
export type ShiftStatus = 'open' | 'closed' | 'reviewed'

export interface ShiftBreakdownDto {
  cashSalesCents: number
  cashSalesCount: number
  cashRefundsCents: number
  paidOutsCents: number
  cashDropsCents: number
  floatTopUpsCents: number
  nonCashSalesCents: number
  expectedNowCents: number
}

export interface ShiftDto {
  id: Uuid
  branchId: Uuid
  branchName: string
  staffUserId: Uuid
  staffName: string
  openedAt: Timestamp
  openingFloatCents: number
  closedAt: Timestamp | null
  countedCashCents: number | null
  expectedCashCents: number | null
  varianceCents: number | null
  needsReview: boolean
  status: ShiftStatus
  closeNote: string | null
  reviewNote: string | null
  reviewedAt: Timestamp | null
  breakdown: ShiftBreakdownDto
}

// ---------- Inventory ----------
export interface StockLevelDto {
  branchId: Uuid
  branchName: string
  quantity: number
  isLow: boolean
}

export interface ProductDto {
  id: Uuid
  sku: string
  barcode: string | null
  name: string
  kind: 'product' | 'service'
  unitPriceCents: number
  unitCostCents: number
  minStockQty: number
  leadTimeDays: number | null
  supplierId: Uuid | null
  supplierName: string | null
  isActive: boolean
  totalQuantity: number
  levels: StockLevelDto[]
}

export interface ProductInput {
  sku: string
  barcode?: string | null
  name: string
  kind: 'product' | 'service'
  unitPriceCents: number
  unitCostCents?: number | null
  minStockQty?: number | null
  leadTimeDays?: number | null
  supplierId?: Uuid | null
  isActive?: boolean
}

export type StockMovementStatus = 'applied' | 'pending_approval' | 'rejected'

export interface StockMovementDto {
  id: Uuid
  productId: Uuid
  productName: string
  branchId: Uuid
  branchName: string
  movementType: string
  quantityDelta: number
  unitCostCents: number | null
  status: StockMovementStatus
  reason: string | null
  source: string
  transactionId: Uuid | null
  providerPaymentId: Uuid | null
  createdBy: Uuid | null
  createdByName: string | null
  approvedBy: Uuid | null
  createdAt: Timestamp
}

export interface ReorderSuggestionDto {
  productId: Uuid
  sku: string
  name: string
  branchId: Uuid
  branchName: string
  onHand: number
  minStock: number
  averageDailySales: number
  leadTimeDays: number
  reorderPoint: number
  suggestedQuantity: number
  estimatedCostCents: number
  isLowStock: boolean
  insufficientHistory: boolean
  supplierName: string | null
  assumptions: string[]
}
