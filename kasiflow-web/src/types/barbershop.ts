/**
 * Barbershop platform contract: mirrors KasiFlow.Api/DTOs/BarbershopDtos.cs and the records declared in
 * Services/Barbershop/*.cs. JSON is camelCase; money is integer cents; timestamps are ISO strings with an offset.
 */
import type { DateOnly, PaymentMethod, ReceivableDto, Severity, Timestamp, Uuid } from './api'

// ---------- Team, status and schedules ----------
export type StaffStatus = 'available' | 'busy' | 'house_call' | 'on_break' | 'unavailable' | 'off_duty'

export interface StaffStatusDto {
  status: StaffStatus
  label: string
  note: string | null
  updatedAt: Timestamp
  expiresAt: Timestamp | null
  expired: boolean
  stale: boolean
  explanation: string | null
  availableNow: boolean
  blocksNewBookings: boolean
}

export interface WorkingHoursDto {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
  start: string
  end: string
}

export type TimeOffKind = 'leave' | 'class' | 'exam' | 'personal' | 'other'

export interface TimeOffDto {
  id: Uuid
  startsAt: Timestamp
  endsAt: Timestamp
  kind: TimeOffKind
  note: string | null
}

export interface StaffServiceDto {
  serviceId: Uuid
  serviceName: string
  priceCents: number
  hasOwnPrice: boolean
}

export interface StaffProfileDto {
  id: Uuid
  displayName: string
  roleTitle: string
  branchId: Uuid | null
  userId: Uuid | null
  isBookable: boolean
  acceptsHouseCalls: boolean
  isActive: boolean
  isYou: boolean
  status: StaffStatusDto
  hours: WorkingHoursDto[]
  services: StaffServiceDto[]
  bookingsToday: number
  bio?: string | null
  specialties?: string | null
  /** Private: null unless the viewer is a manager or the person themself. */
  contactPhone?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  hasLogin?: boolean
  photoCount?: number
  pendingLogin?: PendingLoginDto | null
}

/** A login invitation created for a profile that nobody has accepted yet. */
export interface PendingLoginDto {
  email: string
  expiresAt: Timestamp
}

export interface StaffProfileInput {
  displayName: string
  roleTitle?: string | null
  branchId?: Uuid | null
  userId?: Uuid | null
  isBookable?: boolean
  acceptsHouseCalls?: boolean
  isActive?: boolean
  bio?: string | null
  specialties?: string | null
  contactPhone?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
}

export interface StatusInput {
  status: StaffStatus
  note?: string | null
  forMinutes?: number | null
  revertTo?: StaffStatus | null
}

export interface TimeOffInput {
  startsAt: Timestamp
  endsAt: Timestamp
  kind: TimeOffKind
  note?: string | null
}

export interface StaffServiceInput {
  serviceId: Uuid
  priceCents: number | null
}

export interface WorkspaceDto {
  profile: StaffProfileDto | null
  today: BookingSummaryDto[]
  upcoming: BookingSummaryDto[]
  timeOff: TimeOffDto[]
  team: StaffProfileDto[]
  hint: string | null
}

// ---------- Services ----------
export interface ServiceDto {
  id: Uuid
  name: string
  description: string | null
  category: string | null
  priceCents: number
  durationMinutes: number
  isActive: boolean
  isPublic: boolean
  allowsHouseCall: boolean
  sortOrder: number
}

export interface ServiceInput {
  name: string
  description?: string | null
  category?: string | null
  priceCents: number
  durationMinutes: number
  isActive: boolean
  isPublic: boolean
  allowsHouseCall: boolean
  sortOrder: number
}

// ---------- Bookings ----------
export type BookingStatus = 'requested' | 'confirmed' | 'reschedule_proposed' | 'completed' | 'cancelled' | 'no_show'
export type LocationType = 'in_shop' | 'house_call'
export type BookingAction = 'confirm' | 'propose_reschedule' | 'accept_proposal' | 'reject_proposal' | 'complete' | 'no_show' | 'cancel'

export interface BookingItemInput {
  serviceId: Uuid
  personLabel?: string | null
}

export interface HouseCallInput {
  addressLine?: string | null
  suburb?: string | null
  town?: string | null
  accessNotes?: string | null
  latitude?: number | null
  longitude?: number | null
  distanceKm?: number | null
}

export interface BookingInput {
  staffId?: Uuid | null
  startsAt?: Timestamp | null
  items: BookingItemInput[]
  locationType: LocationType
  houseCall?: HouseCallInput | null
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
  customerId?: Uuid | null
  customerNote?: string | null
  internalNote?: string | null
  discountCents?: number | null
  confirm?: boolean
  offDutyOverride?: boolean
  overrideReason?: string | null
}

export interface BookingSummaryDto {
  id: Uuid
  reference: string
  status: BookingStatus
  statusLabel: string
  startsAt: Timestamp
  endsAt: Timestamp
  staffId: Uuid | null
  staffName: string | null
  customerName: string
  locationType: LocationType
  peopleCount: number
  totalCents: number
  paidCents: number
  servicesSummary: string
  proposedStartsAt: Timestamp | null
  proposedBy: 'customer' | 'business' | null
}

export interface BookingItemDto {
  id: Uuid
  serviceId: Uuid | null
  serviceName: string
  personLabel: string
  unitPriceCents: number
  durationMinutes: number
}

export interface BookingEventDto {
  event: string
  fromStatus: string | null
  toStatus: string | null
  actorKind: string
  note: string | null
  at: Timestamp
}

export interface HouseCallEconomicsDto {
  revenueCents: number
  estimatedCostsCents: number | null
  actualCostsCents: number
  estimatedContributionCents: number | null
  actualContributionCents: number
  hasActualCosts: boolean
  caveat: string
}

export interface HouseCallDto {
  addressLine: string | null
  suburb: string | null
  town: string | null
  accessNotes: string | null
  latitude: number | null
  longitude: number | null
  distanceKm: number | null
  distanceSource: string
  distanceLabel: string
  estimatedTravelCostCents: number | null
  estimatedOtherCostCents: number | null
  addressVisible: boolean
  /** Null for barbers: the shop's margin on a visit is business information. */
  economics: HouseCallEconomicsDto | null
}

export interface BookingPaymentDto {
  transactionId: Uuid
  amountCents: number
  paymentMethod: PaymentMethod
  paymentStatus: string
  date: DateOnly
}

export interface BookingDetailDto {
  summary: BookingSummaryDto
  customerPhone: string | null
  customerEmail: string | null
  customerId: Uuid | null
  customerNote: string | null
  internalNote: string | null
  servicesTotalCents: number
  travelFeeCents: number
  discountCents: number
  proposedTravelFeeCents: number | null
  proposedEndsAt: Timestamp | null
  proposedStaffId: Uuid | null
  proposalNote: string | null
  source: string
  offDutyOverride: boolean
  overrideReason: string | null
  cancelReason: string | null
  items: BookingItemDto[]
  events: BookingEventDto[]
  payments: BookingPaymentDto[]
  houseCall: HouseCallDto | null
  debtIds: Uuid[]
  allowedActions: BookingAction[]
  /** Set when the customer booked with a verified customer account (one-time code). */
  customerAccountId?: Uuid | null
  verifiedContact?: string | null
}

export interface ConfirmInput {
  offDutyOverride?: boolean
  overrideReason?: string | null
}

export interface ProposeInput {
  startsAt: Timestamp
  staffId?: Uuid | null
  travelFeeCents?: number | null
  note?: string | null
}

export interface CompletionPaymentInput {
  amountCents: number
  paymentMethod: PaymentMethod
}

export interface CompleteInput {
  payments: CompletionPaymentInput[]
  createDebtForRemainder: boolean
  debtDueDate?: DateOnly | null
  chargeTermsDisclosed: boolean
  note?: string | null
}

export interface HouseCallUpdateInput {
  distanceKm?: number | null
  estimatedTravelCostCents?: number | null
  estimatedOtherCostCents?: number | null
  accessNotes?: string | null
}

export interface VisitExpenseInput {
  category: string
  amountCents: number
  description?: string | null
  date?: DateOnly | null
  paymentMethod: PaymentMethod
}

export interface SlotDto {
  startsAt: Timestamp
  endsAt: Timestamp
  staffId: Uuid
  staffName: string
}

export interface AvailabilityDto {
  date: DateOnly
  durationMinutes: number
  slots: SlotDto[]
  notes: string[]
}

export interface QuoteDto {
  servicesTotalCents: number
  travelFeeCents: number
  discountCents: number
  totalCents: number
  durationMinutes: number
  travelFeeFinal: boolean
  travelFeeExplanation: string | null
  outsideServiceArea: boolean
}

export interface HouseCallListItemDto {
  booking: BookingSummaryDto
  town: string | null
  distanceLabel: string
  economics: HouseCallEconomicsDto
}

// ---------- Public booking ----------
export interface PublicStaffPriceDto {
  serviceId: Uuid
  priceCents: number
}

export interface PublicPhotoDto {
  id: Uuid
  caption: string | null
  serviceId: Uuid | null
  /** API-relative path, e.g. /api/public/profiles/{slug}/photos/{id}. Public: no auth needed. */
  url: string
}

export interface PublicStaffDto {
  id: Uuid
  displayName: string
  roleTitle: string
  statusLabel: string
  availableNow: boolean
  acceptsHouseCalls: boolean
  bio?: string | null
  specialties?: string | null
  prices?: PublicStaffPriceDto[] | null
  photos?: PublicPhotoDto[] | null
}

export interface PublicServiceDto {
  id: Uuid
  name: string
  description: string | null
  category: string | null
  priceCents: number
  durationMinutes: number
  allowsHouseCall: boolean
}

export interface PublicBookingInfoDto {
  slug: string
  businessName: string
  services: PublicServiceDto[]
  staff: PublicStaffDto[]
  houseCallsEnabled: boolean
  travelFeePolicy: string
  requiresConfirmation: boolean
  horizonDays: number
  disclaimer: string
  /** Creating a booking needs a customer signed in with a one-time code. */
  signInRequired?: boolean
  houseCallsNeedAccount?: boolean
  houseCallTerms?: string | null
}

export interface PublicBookingInput {
  staffId?: Uuid | null
  startsAt: Timestamp
  items: BookingItemInput[]
  locationType: LocationType
  houseCall?: HouseCallInput | null
  /** Defaults to the customer account's name (always the account's for house calls). */
  customerName?: string | null
  customerPhone?: string | null
  customerNote?: string | null
}

export type PublicBookingOp = 'cancel' | 'reschedule' | 'accept-proposal' | 'reject-proposal'

export interface PublicBookingStatusDto {
  reference: string
  businessName: string
  status: BookingStatus
  statusLabel: string
  startsAt: Timestamp
  endsAt: Timestamp
  staffName: string | null
  locationType: LocationType
  services: string[]
  servicesTotalCents: number
  travelFeeCents: number
  totalCents: number
  proposedStartsAt: Timestamp | null
  proposedTravelFeeCents: number | null
  proposedBy: 'customer' | 'business' | null
  proposalNote: string | null
  allowedActions: PublicBookingOp[]
  message: string
  serviceIds?: Uuid[] | null
  staffId?: Uuid | null
}

export interface PublicBookingCreatedDto {
  reference: string
  token: string
  statusPath: string
  booking: PublicBookingStatusDto
}

export interface PublicActionInput {
  token: string
  startsAt?: Timestamp | null
  note?: string | null
}

// ---------- Policies ----------
export type TravelFeeMode = 'none' | 'flat' | 'per_km'

export interface BookingPolicyDto {
  bookingAutoConfirm: boolean
  allowOffDutyOverride: boolean
  slotIntervalMinutes: number
  bookingLeadMinutes: number
  bookingHorizonDays: number
  houseCallsEnabled: boolean
  travelFeeMode: TravelFeeMode
  travelFeeFlatCents: number
  travelFeePerKmCents: number
  minTravelFeeCents: number
  maxTravelKm: number | null
  travelFeeDescription: string
  distanceProviderConfigured: boolean
}

export interface DebtChargePolicyDto {
  enabled: boolean
  amountCents: number
  overdueDays: number
  legallyReviewed: boolean
  reviewedNote: string | null
  terms: string | null
  version: number
  appliesToRealDebts: boolean
  safeguards: string[]
}

export interface DebtChargePolicyInput {
  enabled: boolean
  amountCents: number
  overdueDays: number
  legallyReviewed: boolean
  reviewedNote: string | null
  terms: string | null
}

// ---------- Debts ----------
export type DebtStatus = 'outstanding' | 'partially_paid' | 'overdue' | 'settled' | 'disputed' | 'written_off'
export type ChargeStatus = 'proposed' | 'applied' | 'waived' | 'reversed'
export type ReminderChannel = 'manual' | 'whatsapp' | 'sms' | 'call' | 'in_person'
export type ReminderOutcome = 'sent' | 'promised' | 'no_answer' | 'refused'

export interface DebtChargeDto {
  id: Uuid
  eventKey: string
  amountCents: number
  status: ChargeStatus
  basis: string
  createdAt: Timestamp
  decidedAt: Timestamp | null
  decisionReason: string | null
}

export interface StatementLineDto {
  at: Timestamp
  kind: string
  description: string
  amountCents: number | null
  balanceAfterCents: number | null
  note: string | null
}

export interface ReminderDto {
  id: Uuid
  channel: ReminderChannel
  outcome: ReminderOutcome
  note: string | null
  at: Timestamp
}

export interface ReminderInput {
  channel: ReminderChannel
  outcome: ReminderOutcome
  note?: string | null
}

export interface DebtBalanceDto {
  originalPrincipalCents: number
  paidCents: number
  writtenOffCents: number
  principalOutstandingCents: number
  appliedChargesCents: number
  chargesOutstandingCents: number
  proposedChargesCents: number
  totalOutstandingCents: number
  explanation: string
}

export interface DebtAccountDto {
  debt: ReceivableDto
  statusLabel: string
  balance: DebtBalanceDto
  charges: DebtChargeDto[]
  statement: StatementLineDto[]
  reminders: ReminderDto[]
  chargeTermsSnapshot: string | null
  chargeTermsDisclosedAt: Timestamp | null
  remindersPaused: boolean
  remindersPausedReason: string | null
}

export interface OverdueDebtDto {
  debt: ReceivableDto
  reminderCount: number
  failedAttempts: number
  lastReminderAt: Timestamp | null
  needsReview: boolean
  reviewReason: string | null
}

export interface ExpectedCollectionDto {
  debtId: Uuid
  customerName: string
  dueDate: DateOnly
  amountCents: number
  label: string
}

export interface OverdueReportDto {
  overduePrincipalCents: number
  overdueChargesCents: number
  overdueCount: number
  expectedNext30DaysCents: number
  items: OverdueDebtDto[]
  expectedCollections: ExpectedCollectionDto[]
  note: string
}

// ---------- Money summary ----------
export type MoneyPeriod = 'day' | 'week' | 'month'

export interface MoneyFigureDto {
  key: string
  label: string
  amountCents: number
  explanation: string
}

export interface MoneySummaryDto {
  period: MoneyPeriod
  from: DateOnly
  to: DateOnly
  salesRevenueCents: number
  receivedCents: number
  unpaidFromSalesCents: number
  expensesCents: number
  refundsCents: number
  discountsCents: number
  estimatedContributionCents: number
  pendingConfirmationCents: number
  unsettledProviderCents: number
  outstandingReceivablesCents: number
  overdueReceivablesCents: number
  billsDueNext7DaysCents: number
  overdueBillsCents: number
  expectedCollectionsNext7DaysCents: number
  availableCashCents: number | null
  availableCashNote: string | null
  cashGapNext7DaysCents: number | null
  completedBookings: number
  upcomingBookingsToday: number
  receivedByMethod: { paymentMethod: PaymentMethod; amountCents: number }[]
  figures: MoneyFigureDto[]
  notes: string[]
}

// ---------- Alerts ----------
export type AlertStatus = 'open' | 'under_review' | 'resolved' | 'false_positive'

export interface AlertEvidenceDto {
  sourceType: string
  sourceId: Uuid | null
  label: string
  amountCents: number | null
  date: DateOnly | null
  detail: string | null
}

export interface AlertDto {
  id: Uuid
  ruleCode: string
  severity: Severity
  title: string
  reason: string
  evidence: AlertEvidenceDto[]
  affectedType: string | null
  affectedId: Uuid | null
  recommendedAction: string
  status: AlertStatus
  reviewerId: Uuid | null
  reviewNote: string | null
  reviewedAt: Timestamp | null
  firstDetectedAt: Timestamp
  lastDetectedAt: Timestamp
}

export interface AlertSummaryDto {
  open: number
  underReview: number
  critical: number
  warning: number
  items: AlertDto[]
  disclaimer: string
}

// ---------- Payment proofs ----------
export type ProofStatus = 'unverified' | 'verified_by_provider' | 'confirmed_in_bank' | 'rejected'

export interface PaymentProofDto {
  id: Uuid
  transactionId: Uuid | null
  bookingId: Uuid | null
  receivableId: Uuid | null
  fileName: string
  contentType: string
  sizeBytes: number
  claimedAmountCents: number | null
  claimedReference: string | null
  payerName: string | null
  status: ProofStatus
  statusLabel: string
  verificationNote: string | null
  verifiedAt: Timestamp | null
  createdAt: Timestamp
  duplicateFile: boolean
  warning: string
}

// ---------- Supplier bank details ----------
export type BankDetailStatus = 'unverified' | 'verified' | 'rejected' | 'superseded'
export type BankChangeSource = 'owner_entry' | 'supplier_message' | 'invoice' | 'other'
export type BankVerifyMethod = 'called_known_number' | 'in_person' | 'bank_confirmation_letter' | 'other'

export interface SupplierBankDetailDto {
  id: Uuid
  bankName: string
  accountHolder: string
  accountMasked: string
  status: BankDetailStatus
  changeSource: BankChangeSource
  verificationMethod: BankVerifyMethod | null
  verificationNote: string | null
  verifiedAt: Timestamp | null
  createdAt: Timestamp
  sameAsVerified: boolean
}

export interface SupplierBankInput {
  bankName: string
  accountHolder: string
  accountNumber: string
  changeSource: BankChangeSource
}

export interface VerifyBankInput {
  method?: BankVerifyMethod | null
  note: string
}

// ---------- Manager: today on the floor (GET /api/floor). Deliberately no money totals. ----------
export interface FloorTeamMemberDto {
  id: Uuid
  displayName: string
  roleTitle: string
  status: StaffStatus
  statusLabel: string
  availableNow: boolean
  stale: boolean
  note: string | null
  bookingsToday: number
  /** 'HH:mm' (South African time) of their next appointment today, or null. */
  nextAt: string | null
}

export interface FloorHouseCallDto {
  bookingId: Uuid
  reference: string
  staffName: string | null
  startsAt: Timestamp
  stage: string
  stageLabel: string
  overdue: boolean
  helpActive: boolean
}

export type FloorAttentionKind = 'safety' | 'bookings' | 'alerts' | 'shifts' | 'team'

export interface FloorAttentionDto {
  kind: FloorAttentionKind
  severity: Severity
  title: string
  detail: string
  link: string
}

export interface FloorDto {
  date: DateOnly
  requested: number
  confirmed: number
  completed: number
  noShows: number
  houseCalls: number
  team: FloorTeamMemberDto[]
  today: BookingSummaryDto[]
  houseCallSafety: FloorHouseCallDto[]
  needsAttention: FloorAttentionDto[]
}
