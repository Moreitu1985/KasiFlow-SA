import type { ExperienceDto } from '@/lib/experience'
/**
 * DTO types for the KasiFlow SA REST API. Source of truth: docs/API.md.
 * Money: integer cents in fields ending `Cents`. Dates: `YYYY-MM-DD`. Timestamps: ISO-8601 UTC.
 */

export type Uuid = string
export type DateOnly = string
export type Timestamp = string

// ---------- Enums ----------
export type Province =
  | 'eastern_cape'
  | 'free_state'
  | 'gauteng'
  | 'kwazulu_natal'
  | 'limpopo'
  | 'mpumalanga'
  | 'north_west'
  | 'northern_cape'
  | 'western_cape'
export type RegistrationStatus = 'not_started' | 'in_progress' | 'registered' | 'not_sure'
export type TransactionType = 'income' | 'expense'
export type PaymentMethod = 'cash' | 'eft' | 'card' | 'mobile_payment' | 'other'
/** `confirmed_external` is reserved for a future verified provider; the API rejects it on input. */
export type PaymentStatus = 'recorded_manually' | 'awaiting_confirmation' | 'failed' | 'cancelled' | 'confirmed_external'
export type InputPaymentStatus = Exclude<PaymentStatus, 'confirmed_external'>
export type TransactionStatus = 'posted' | 'scheduled' | 'voided'
export type TransactionSource = 'manual' | 'receivable_payment' | 'payable_payment'
export type ReceivableStatus = 'open' | 'settled' | 'written_off'
export type PayableStatus = 'open' | 'paid' | 'cancelled'
export type Severity = 'informational' | 'warning' | 'critical'
export type RecommendationStatus = 'open' | 'dismissed' | 'resolved'
export type OpportunityType = 'funding' | 'procurement' | 'supplier_registration' | 'training' | 'market_access' | 'other'
export type VerificationStatus = 'verified_official' | 'requires_verification' | 'sample'
export type ApplicationStatus = 'saved' | 'preparing' | 'applied' | 'successful' | 'unsuccessful' | 'closed'
export type IncidentType =
  | 'suspicious_payment_request'
  | 'fake_proof_of_payment'
  | 'bank_detail_change'
  | 'impersonation'
  | 'upfront_fee_scam'
  | 'phishing'
  | 'urgent_payment_pressure'
  | 'credential_request'
  | 'other'
export type IncidentStatus = 'open' | 'monitoring' | 'resolved'
export type BankAccountStatus = 'has_business_account' | 'uses_personal_account' | 'not_applicable'
export type DashboardPeriod = 'this_week' | 'this_month' | 'last_month' | 'last_30_days' | 'custom'

export interface Paged<T> {
  items: T[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export interface PeriodDto {
  from: DateOnly
  to: DateOnly
  label: string
}

// ---------- Me / businesses ----------
export interface BusinessDto {
  id: Uuid
  name: string
  businessType: string
  ownerName: string
  contactEmail: string
  contactPhone: string | null
  province: Province
  town: string | null
  registrationStatus: RegistrationStatus
  currency: 'ZAR'
  createdAt: Timestamp
  updatedAt: Timestamp
  /** The caller's role in this business (owner, business_admin, branch_manager, cashier, staff, accountant). */
  role: string
  /** camelCase permission names, e.g. "viewFinancials". The API is the authority; the UI only mirrors them. */
  permissions: string[]
  /** The fictional demo business: sandbox simulations are allowed and data is not real money. */
  isDemo: boolean
  /** The app this role sees (home, screens, phone tabs), decided by the API. */
  experience?: ExperienceDto | null
}

export interface BusinessInput {
  name: string
  businessType: string
  ownerName: string
  contactEmail: string
  contactPhone?: string | null
  province: Province
  town?: string | null
  registrationStatus: RegistrationStatus
}

export interface MeDto {
  userId: Uuid
  email: string
  businesses: BusinessDto[]
}

// ---------- Settings ----------
export interface SettingsDto {
  openingCashBalanceCents: number
  openingBalanceDate: DateOnly | null
  cashBufferCents: number
  forecastDays: number
  largeTxMultiplier?: number
  cashupVarianceThresholdCents?: number
  reorderSafetyDays?: number
  reorderCoverDays?: number
  defaultLeadTimeDays?: number
}

// ---------- Growth / forecast ----------
export type ForecastEventKind = 'scheduled_income' | 'expected_collection' | 'scheduled_expense' | 'supplier_bill'
export type SourceType = 'transaction' | 'receivable' | 'payable'

export interface ForecastEvent {
  kind: ForecastEventKind
  sourceType: SourceType
  sourceId: Uuid
  description: string
  counterparty: string | null
  amountCents: number
  isExpected: boolean
  isOverdueCarryForward: boolean
}

export interface ForecastDay {
  date: DateOnly
  openingBalanceCents: number
  scheduledInflowsCents: number
  expectedInflowsCents: number
  outflowsCents: number
  expectedClosingCents: number
  conservativeClosingCents: number
  belowBuffer: boolean
  belowZero: boolean
  events: ForecastEvent[]
  optimisticClosingCents: number
}

export interface ForecastDto {
  asOf: DateOnly
  horizonDays: number
  openingBalanceCents: number
  cashBufferCents: number
  openingBalanceConfigured: boolean
  days: ForecastDay[]
  lowestExpected: { date: DateOnly; balanceCents: number }
  lowestConservative: { date: DateOnly; balanceCents: number }
  firstShortageDate: DateOnly | null
  firstBelowBufferDate: DateOnly | null
  firstConservativeShortageDate: DateOnly | null
  totals: { scheduledInflowsCents: number; expectedInflowsCents: number; outflowsCents: number }
  excluded: { sourceType: SourceType; sourceId: Uuid; description: string; amountCents: number; reason: string }[]
  assumptions: string[]
  lowestOptimistic: { date: DateOnly; balanceCents: number } | null
  totalOptimisticExtraCents: number
  isPreliminary: boolean
  preliminaryReason: string | null
  scenarios: ForecastScenario[] | null
}

export interface ForecastScenario {
  key: string
  name: string
  assumption: string
}

export interface EvidenceItem {
  /** Documented values: transaction | receivable | payable. Other strings are shown without a link. */
  sourceType: string
  sourceId: Uuid | null
  label: string
  amountCents: number | null
  date: DateOnly | null
  detail: string | null
}

export interface RecommendationDto {
  id: Uuid
  ruleCode: string
  title: string
  severity: Severity
  explanation: string
  evidence: EvidenceItem[]
  relevantDates: { label: string; date: DateOnly }[]
  actions: string[]
  estimatedImpactCents: number | null
  status: RecommendationStatus
  resolutionNote: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface GrowthRuleDto {
  code: string
  name: string
  description: string
  severity: Severity
}

export interface RefreshResultDto {
  created: number
  updated: number
  autoResolved: number
}

// ---------- Dashboard ----------
export interface DashboardSummaryDto {
  period: PeriodDto
  hasAnyTransactions: boolean
  openingBalanceConfigured: boolean
  cashBalanceCents: number
  awaitingConfirmationCents: number
  incomeCents: number
  expensesCents: number
  netResultCents: number
  outstandingReceivablesCents: number
  overdueReceivablesCents: number
  upcomingPayablesCents: number
  overduePayablesCents: number
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
  }
  forecastSeries: { date: DateOnly; expectedBalanceCents: number; conservativeBalanceCents: number; optimisticBalanceCents: number }[]
  openRecommendations: { total: number; critical: number; warning: number; informational: number }
  fundingReadinessPercent: number
  registrationProgressPercent: number
  incomeVsExpenses: { month: string; label: string; incomeCents: number; expensesCents: number }[]
  upcomingObligations: {
    payableId: Uuid
    supplierName: string
    description: string
    dueDate: DateOnly
    remainingCents: number
    isOverdue: boolean
  }[]
  priorityActions: RecommendationDto[]
}

// ---------- Transactions ----------
export interface TransactionDto {
  id: Uuid
  type: TransactionType
  description: string
  amountCents: number
  category: string
  transactionDate: DateOnly
  paymentMethod: PaymentMethod
  paymentStatus: PaymentStatus
  status: TransactionStatus
  source: TransactionSource
  reference: string | null
  notes: string | null
  voidReason: string | null
  voidedAt: Timestamp | null
  createdAt: Timestamp
  updatedAt: Timestamp
  receivableId: Uuid | null
  payableId: Uuid | null
  counterpartyName: string | null
  origin: TransactionOrigin
  branchId: Uuid | null
  branchName: string | null
  shiftId: Uuid | null
  providerPaymentId: Uuid | null
  providerKey: string | null
  providerStatus: string | null
}

export type TransactionOrigin = 'staff_recorded' | 'connected_pos' | 'verified_provider' | 'imported_file' | 'demo_simulation'

export interface LineItemInput {
  productId: Uuid
  quantity: number
}

export interface TransactionInput {
  type: TransactionType
  description: string
  amountCents: number
  category: string
  transactionDate: DateOnly
  paymentMethod: PaymentMethod
  paymentStatus?: InputPaymentStatus
  status?: 'posted' | 'scheduled'
  reference?: string | null
  notes?: string | null
  branchId?: Uuid | null
  lineItems?: LineItemInput[]
}

export interface TransactionCategories {
  income: string[]
  expense: string[]
}

export interface TransactionQuery {
  type?: TransactionType | ''
  category?: string
  status?: TransactionStatus | 'all' | ''
  from?: DateOnly
  to?: DateOnly
  search?: string
  page?: number
  pageSize?: number
  branchId?: Uuid | ''
  origin?: TransactionOrigin | ''
}

// ---------- Customers / receivables ----------
export interface CustomerDto {
  id: Uuid
  name: string
  phone: string | null
  email: string | null
  notes: string | null
  isArchived: boolean
  outstandingCents: number
  openDebts: number
  createdAt: Timestamp
}

export interface ContactInput {
  name: string
  phone?: string | null
  email?: string | null
  notes?: string | null
  isArchived?: boolean
}

export interface PaymentRecordDto {
  id: Uuid
  transactionId: Uuid
  amountCents: number
  paymentDate: DateOnly
  paymentMethod: PaymentMethod
  reference: string | null
  isVoided: boolean
}

export interface ReceivableDto {
  id: Uuid
  customerId: Uuid
  customerName: string
  description: string
  originalAmountCents: number
  paidCents: number
  writtenOffCents: number
  remainingCents: number
  issueDate: DateOnly
  dueDate: DateOnly | null
  status: ReceivableStatus
  isOverdue: boolean
  daysOverdue: number
  notes: string | null
  createdAt: Timestamp
  principalOutstandingCents?: number
  chargesOutstandingCents?: number
  proposedChargesCents?: number
  debtStatus?: 'outstanding' | 'partially_paid' | 'overdue' | 'settled' | 'disputed' | 'written_off'
  disputed?: boolean
  reference?: string | null
  chargeTermsDisclosed?: boolean
}

export interface ReceivableDetailDto extends ReceivableDto {
  payments: PaymentRecordDto[]
  disputeReason?: string | null
  chargeTermsSnapshot?: string | null
}

export interface ReceivableSummaryDto {
  totalOutstandingCents: number
  overdueCents: number
  upcomingCents: number
  openCount: number
  topDebtors: { customerId: Uuid; customerName: string; outstandingCents: number }[]
}

export interface ReceivableInput {
  customerId: Uuid
  description: string
  originalAmountCents: number
  issueDate: DateOnly
  dueDate?: DateOnly | null
  notes?: string | null
  reference?: string | null
  chargeTermsDisclosed?: boolean
}

export interface PaymentInput {
  amountCents: number
  paymentDate: DateOnly
  paymentMethod: PaymentMethod
  reference?: string | null
  /** Set after the API's duplicate-payment guard (409) when the person confirms it is a separate payment. */
  confirmDuplicate?: boolean
}

// ---------- Suppliers / payables ----------
export type SupplierDto = Omit<CustomerDto, 'openDebts'> & { openBills: number }

export interface PayableDto {
  id: Uuid
  supplierId: Uuid
  supplierName: string
  description: string
  category: string
  originalAmountCents: number
  paidCents: number
  remainingCents: number
  billDate: DateOnly
  dueDate: DateOnly
  status: PayableStatus
  isOverdue: boolean
  daysUntilDue: number
  reference: string | null
  notes: string | null
  createdAt: Timestamp
}

export interface PayableDetailDto extends PayableDto {
  payments: PaymentRecordDto[]
}

export interface PayableSummaryDto {
  totalOutstandingCents: number
  overdueCents: number
  dueNext7DaysCents: number
  dueNext30DaysCents: number
  openCount: number
}

export interface PayableInput {
  supplierId: Uuid
  description: string
  category: string
  originalAmountCents: number
  billDate: DateOnly
  dueDate: DateOnly
  reference?: string | null
  notes?: string | null
}

// ---------- Opportunities ----------
export interface OpportunityTracking {
  id: Uuid
  applicationStatus: ApplicationStatus
  notes: string | null
  personalDeadline: DateOnly | null
  updatedAt: Timestamp
}

export interface OpportunityDto {
  id: Uuid
  title: string
  description: string
  organisation: string
  opportunityType: OpportunityType
  industry: string
  eligibilityCriteria: string
  requiredDocuments: string[]
  applicationDeadline: DateOnly | null
  sourceUrl: string | null
  geographicScope: string
  verificationStatus: VerificationStatus
  lastCheckedOn: DateOnly | null
  isPrivate: boolean
  tracking: OpportunityTracking | null
}

export interface OpportunityInput {
  title: string
  description: string
  organisation: string
  opportunityType: OpportunityType
  industry?: string | null
  eligibilityCriteria?: string | null
  requiredDocuments?: string[]
  applicationDeadline?: DateOnly | null
  sourceUrl?: string | null
  geographicScope?: string | null
}

export interface TrackingInput {
  applicationStatus: ApplicationStatus
  notes?: string | null
  personalDeadline?: DateOnly | null
}

// ---------- Readiness ----------
export interface RegistrationStepDto {
  key: string
  title: string
  description: string
  appliesTo: string
  resources: { title: string; url: string; purpose: string; lastChecked?: string | null }[]
  completed: boolean
  notes: string | null
  updatedAt: Timestamp | null
}

export interface RegistrationDto {
  registrationStatus: RegistrationStatus
  progressPercent: number
  completedCount: number
  totalCount: number
  disclaimer: string
  steps: RegistrationStepDto[]
}

export interface FundingItemDto {
  key: string
  title: string
  description: string
  howToComplete: string
  mode: 'automatic' | 'manual'
  completed: boolean
  notes: string | null
  appRoute: string | null
}

export interface FundingProfileDto {
  fundingPurpose: string | null
  amountRequestedCents: number | null
  businessBankAccountStatus: BankAccountStatus | null
}

export interface FundingReadinessDto {
  percent: number
  completedCount: number
  totalCount: number
  disclaimer: string
  profile: FundingProfileDto
  items: FundingItemDto[]
}

// ---------- Public profile ----------
/**
 * The contract does not specify the JSON type of `productsServices`; it is treated as free text
 * (one item per line) and normalised for display if the API returns an array.
 */
export interface PublicProfileSettingsDto {
  exists: boolean
  slug: string | null
  isPublished: boolean
  description: string | null
  category: string | null
  productsServices: string | null
  showPhone: boolean
  showEmail: boolean
  showTown: boolean
  serviceArea: string | null
  openingHours: string | null
  imageUrl: string | null
  publicUrlPath: string | null
}

export type PublicProfileSettingsInput = Omit<PublicProfileSettingsDto, 'exists' | 'publicUrlPath'>

export interface PublicProfileDto {
  slug: string
  businessName: string
  description: string | null
  category: string | null
  productsServices: string | string[] | null
  province: Province | null
  town: string | null
  serviceArea: string | null
  openingHours: string | null
  imageUrl: string | null
  phone: string | null
  email: string | null
}

// ---------- Fraud ----------
export interface FraudIncidentDto {
  id: Uuid
  incidentType: IncidentType
  description: string
  incidentDate: DateOnly
  relatedTransactionId: Uuid | null
  status: IncidentStatus
  actionTaken: string | null
  privateNotes: string | null
  createdAt: Timestamp
  updatedAt: Timestamp
}

export interface FraudIncidentInput {
  incidentType: IncidentType
  description: string
  incidentDate: DateOnly
  relatedTransactionId?: Uuid | null
  status: IncidentStatus
  actionTaken?: string | null
  privateNotes?: string | null
}

// ---------- Reports ----------
export interface CategoryBreakdownRow {
  type: TransactionType
  category: string
  totalCents: number
  count: number
  sharePercent: number
}

export interface MonthlyRow {
  month: string
  label: string
  incomeCents: number
  expensesCents: number
  netCents: number
}

export interface FinancialSummaryDto {
  period: PeriodDto
  incomeCents: number
  expensesCents: number
  netResultCents: number
  transactionCount: number
  categoryBreakdown: CategoryBreakdownRow[]
  monthly: MonthlyRow[]
}

export interface BusinessSummaryDto {
  generatedAt: Timestamp
  business: {
    name: string
    businessType: string
    province: Province
    town: string | null
    registrationStatus: RegistrationStatus
  }
  period: PeriodDto
  incomeCents: number
  expensesCents: number
  netResultCents: number
  categoryBreakdown: CategoryBreakdownRow[]
  monthly: MonthlyRow[]
  cashBalanceCents: number
  outstandingReceivablesCents: number
  outstandingPayablesCents: number
  forecast: {
    horizonDays: number
    lowestExpectedBalanceCents: number
    lowestExpectedBalanceDate: DateOnly
    closingExpectedBalanceCents: number
  }
  readinessPercent: number
  fundingPurpose: string | null
  amountRequestedCents: number | null
  disclaimer: string
}

export type ExportKind =
  | 'transactions'
  | 'category-breakdown'
  | 'monthly'
  | 'receivables'
  | 'payables'
  | 'cash-flow'
  | 'readiness'
  | 'business-summary'

export interface ProblemDetails {
  type?: string
  title?: string
  status?: number
  detail?: string
  instance?: string
  errors?: Record<string, string[]>
  traceId?: string
}
