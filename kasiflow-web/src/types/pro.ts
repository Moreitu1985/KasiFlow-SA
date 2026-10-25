/**
 * Walk-in queue, barber pay, the house-call map and owner insights. Mirrors KasiFlow.Api/Services/Barbershop/QueuePayInsights.cs.
 * JSON is camelCase; money is integer cents; times are ISO strings (UTC); dates are YYYY-MM-DD.
 */
import type { PaymentMethod, Timestamp, Uuid } from './api'

// ---------- Walk-in queue ----------
export type QueueStatus = 'waiting' | 'called' | 'in_chair' | 'done' | 'left' | 'no_show'
export type QueueAction = 'call' | 'start' | 'requeue' | 'done' | 'left' | 'no_show'

export interface QueueTicketDto {
  id: Uuid
  number: number
  /** Barbers get "First L." only. */
  customerName: string
  status: QueueStatus
  statusLabel: string
  servicesSummary: string
  estMinutes: number
  preferredStaffId: Uuid | null
  preferredStaffName: string | null
  staffId: Uuid | null
  staffName: string | null
  joinedAt: Timestamp
  calledAt: Timestamp | null
  startedAt: Timestamp | null
  finishedAt: Timestamp | null
  position: number | null
  /** An estimate as a range, e.g. "About 20–35 min". */
  waitLabel: string | null
  waitedMinutes: number
  source: 'desk' | 'customer'
  bookingId: Uuid | null
  allowedActions: QueueAction[]
}

export interface QueueBoardDto {
  date: string
  enabled: boolean
  waiting: number
  inChair: number
  doneToday: number
  barbersWorking: number
  nextWaitLabel: string
  averageWaitMinutes: number | null
  open: QueueTicketDto[]
  finished: QueueTicketDto[]
}

export interface QueueJoinInput {
  customerName?: string | null
  customerPhone?: string | null
  serviceIds?: Uuid[]
  preferredStaffId?: Uuid | null
}

export interface QueuePaymentInput {
  amountCents: number
  paymentMethod: PaymentMethod
}

export interface QueueActionInput {
  staffId?: Uuid | null
  payments?: QueuePaymentInput[]
  note?: string | null
}

export interface PublicQueueDto {
  slug: string
  businessName: string
  enabled: boolean
  waiting: number
  barbersWorking: number
  nextWaitLabel: string
}

export interface PublicTicketDto {
  id: Uuid
  number: number
  businessName: string
  status: QueueStatus
  statusLabel: string
  position: number | null
  waitLabel: string | null
  staffName: string | null
  servicesSummary: string
  message: string
}

export interface PublicTicketCreatedDto {
  id: Uuid
  number: number
  token: string
  /** "/q/{id}?t=…" */
  statusPath: string
  ticket: PublicTicketDto
}

// ---------- Barber pay ----------
export type PayMode = 'commission' | 'chair_rent' | 'wage'

export interface PayTermsDto {
  staffId: Uuid
  mode: PayMode | null
  modeLabel: string | null
  commissionPercent: number | null
  chairRentWeeklyCents: number | null
  wageWeeklyCents: number | null
}

export interface PayTermsInput {
  mode: PayMode
  commissionPercent?: number | null
  chairRentWeeklyCents?: number | null
  wageWeeklyCents?: number | null
}

export interface EarningsDayDto {
  date: string
  visits: number
  servicesCents: number
}

export interface EarningsDto {
  staffId: Uuid
  displayName: string
  from: string
  to: string
  terms: PayTermsDto
  visits: number
  walkIns: number
  houseCalls: number
  servicesCents: number
  travelFeesCents: number
  commissionCents: number
  wageCents: number
  chairRentCents: number
  earnedCents: number
  paidOutCents: number
  /** Positive: the shop owes the barber. Negative: the barber owes the shop (e.g. chair rent). */
  balanceCents: number
  explanation: string
  days: EarningsDayDto[]
  disclaimer: string
}

export interface PayrollDto {
  from: string
  to: string
  barbers: EarningsDto[]
  totalServicesCents: number
  totalOwedToBarbersCents: number
  totalOwedToShopCents: number
  disclaimer: string
}

export interface PayoutInput {
  staffId: Uuid
  /** Positive = paid to the barber (Wages expense); negative = chair rent received from the barber (income). */
  amountCents: number
  from: string
  to: string
  paymentMethod: PaymentMethod
  note?: string | null
}

// ---------- House-call map ----------
export interface MapPointDto {
  latitude: number
  longitude: number
  at: Timestamp | null
  label: string
}

export interface MapHouseCallDto {
  bookingId: Uuid
  reference: string
  status: string
  startsAt: Timestamp
  staffName: string | null
  customerName: string
  area: string | null
  address: MapPointDto | null
  lastShared: MapPointDto | null
  stage: string
  stageLabel: string
  overdue: boolean
  helpActive: boolean
}

export interface HouseCallMapDto {
  date: string
  visits: MapHouseCallDto[]
  withoutPin: number
  note: string
}

// ---------- Owner insights ----------
export interface HeatCellDto {
  /** 0 = Sunday … 6 = Saturday */
  weekday: number
  hour: number
  visits: number
}

export interface TopServiceDto {
  name: string
  count: number
  revenueCents: number
}

export interface BarberPerformanceDto {
  staffId: Uuid
  name: string
  visits: number
  revenueCents: number
  averageTicketCents: number
  noShows: number
  noShowRate: number
  repeatCustomerRate: number
  walkIns: number
  houseCalls: number
}

export interface ShopInsightsDto {
  from: string
  to: string
  days: number
  visits: number
  /** Services booked on completed visits, not cash received. */
  revenueCents: number
  averageTicketCents: number
  uniqueCustomers: number
  repeatCustomers: number
  repeatRate: number
  walkInShare: number
  houseCallShare: number
  averageQueueWaitMinutes: number | null
  busiestSlot: string
  heatmap: HeatCellDto[]
  topServices: TopServiceDto[]
  barbers: BarberPerformanceDto[]
  notes: string[]
}
