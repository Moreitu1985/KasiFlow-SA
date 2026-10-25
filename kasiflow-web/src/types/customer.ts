/**
 * Customer accounts (one-time-code sign-in), barber registration, portfolios and house-call safety.
 * Mirrors KasiFlow.Api/DTOs/BarbershopDtos.cs. JSON is camelCase; money is integer cents; times are ISO strings.
 */
import type { Timestamp, Uuid } from './api'
import type { ExperienceDto } from '@/lib/experience'
import type { BookingStatus, LocationType, StaffProfileDto, StaffServiceInput, WorkingHoursDto } from './barbershop'

// ---------- Customer account (no business involved) ----------
export type VerifiedChannel = 'email' | 'phone'

export interface CustomerAccountDto {
  verifiedContact: string
  verifiedChannel: VerifiedChannel
  fullName: string | null
  contactPhone: string | null
  addressLine: string | null
  suburb: string | null
  town: string | null
  accessNotes: string | null
  houseCallTermsAccepted: boolean
  houseCallTerms: string
  houseCallReady: boolean
  /** Human-readable items still needed before house calls can be booked. */
  missingForHouseCall: string[]
  memberSince: Timestamp
  /** The customer app (screens, home, tabs), decided by the API. */
  experience?: ExperienceDto | null
}

export interface CustomerAccountInput {
  fullName?: string | null
  contactPhone?: string | null
  addressLine?: string | null
  suburb?: string | null
  town?: string | null
  accessNotes?: string | null
  /** true = agree to the current terms, false = withdraw, null = leave unchanged. */
  acceptHouseCallTerms?: boolean | null
}

export interface CustomerBookingDto {
  reference: string
  businessName: string
  slug: string | null
  status: BookingStatus
  statusLabel: string
  startsAt: Timestamp
  endsAt: Timestamp
  staffName: string | null
  locationType: LocationType
  servicesSummary: string
  totalCents: number
  needsYourAnswer: boolean
}

// ---------- Barber registration ----------
export interface RegisterBarberInput {
  displayName: string
  roleTitle?: string | null
  branchId?: Uuid | null
  acceptsHouseCalls?: boolean
  bio?: string | null
  specialties?: string | null
  contactPhone?: string | null
  emergencyContactName?: string | null
  emergencyContactPhone?: string | null
  services?: StaffServiceInput[]
  hours?: WorkingHoursDto[]
  loginEmail?: string | null
}

export interface RegisterBarberResultDto {
  profile: StaffProfileDto
  inviteToken: string | null
  /** e.g. /join?token=… — opens the existing join page. */
  invitePath: string | null
  inviteMessage: string | null
}

// ---------- Portfolio ----------
export interface PortfolioPhotoDto {
  id: Uuid
  staffId: Uuid
  serviceId: Uuid | null
  serviceName: string | null
  caption: string | null
  contentType: string
  sizeBytes: number
  isPublic: boolean
  createdAt: Timestamp
  /** /api/team/{staffId}/portfolio/{id}/file — needs auth, fetch as a blob. */
  url: string
}

export interface PortfolioUpdateInput {
  caption?: string | null
  isPublic?: boolean | null
  serviceId?: Uuid | null
}

// ---------- House-call safety ----------
export type SafetyStage = 'not_started' | 'departed' | 'arrived' | 'finished' | 'returned'
export type SafetyCheckinKind = 'departed' | 'arrived' | 'finished' | 'returned' | 'help' | 'all_clear'
export type SafetyNoteCategory = 'access' | 'pets' | 'conduct' | 'safety_concern' | 'other'

export interface SafetyCheckinDto {
  id: Uuid
  kind: SafetyCheckinKind
  label: string
  at: Timestamp
  note: string | null
  latitude: number | null
  longitude: number | null
  accuracyM: number | null
  mapUrl: string | null
  byName: string
}

export interface SafetyCheckinInput {
  kind: SafetyCheckinKind
  note?: string | null
  latitude?: number | null
  longitude?: number | null
  accuracyM?: number | null
}

export interface SafetyNoteDto {
  id: Uuid
  category: SafetyNoteCategory
  note: string
  authorName: string
  at: Timestamp
  bookingReference: string | null
}

export interface SafetyNoteInput {
  category: SafetyNoteCategory
  note: string
}

export interface CustomerAccountSummaryDto {
  userId: Uuid
  fullName: string | null
  contactPhone: string | null
  verifiedContact: string | null
  memberSince: Timestamp | null
  visitsWithUs: number
  noShowsWithUs: number
  cancelledByCustomer: number
  houseCallsBlocked: boolean
  blockReason: string | null
  safetyNotes: SafetyNoteDto[]
  canBlock: boolean
}

export interface HouseCallSafetyDto {
  bookingId: Uuid
  reference: string
  stage: SafetyStage
  stageLabel: string
  helpActive: boolean
  overdue: boolean
  overdueReason: string | null
  checkBy: Timestamp | null
  nextActions: SafetyCheckinKind[]
  canCheckIn: boolean
  isAssignedBarber: boolean
  timeline: SafetyCheckinDto[]
  barberName: string | null
  /** Managers only. */
  barberPhone: string | null
  /** Managers only. */
  emergencyContact: string | null
  customer: CustomerAccountSummaryDto | null
  emergencyAdvice: string
  graceMinutes: number
}

// ---------- Customer catalogue (GET /api/public/shops, anonymous) ----------
export interface ShopCardDto {
  slug: string
  name: string
  town: string | null
  description: string | null
  category: string | null
  serviceCount: number
  priceFromCents: number | null
  barberCount: number
  availableNow: number
  houseCalls: boolean
  photoCount: number
  /** API-relative path, or null when the shop has no public photo. */
  coverPhotoUrl: string | null
  /** e.g. /p/{slug}/book */
  bookPath: string
}
