import type {
  ApplicationStatus,
  BankAccountStatus,
  IncidentStatus,
  IncidentType,
  OpportunityType,
  PaymentMethod,
  PaymentStatus,
  Province,
  RegistrationStatus,
  Severity,
  TransactionStatus,
  VerificationStatus,
} from '@/types/api'

export const PROVINCES: Record<Province, string> = {
  eastern_cape: 'Eastern Cape',
  free_state: 'Free State',
  gauteng: 'Gauteng',
  kwazulu_natal: 'KwaZulu-Natal',
  limpopo: 'Limpopo',
  mpumalanga: 'Mpumalanga',
  north_west: 'North West',
  northern_cape: 'Northern Cape',
  western_cape: 'Western Cape',
}

export const REGISTRATION_STATUS: Record<RegistrationStatus, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  registered: 'Registered',
  not_sure: 'Not sure',
}

export const BUSINESS_TYPES = [
  'Spaza shop',
  'Barber / hair salon',
  'Food vendor',
  'Clothing & retail',
  'Freelancer / services',
  'Other',
] as const

export const PAYMENT_METHODS: Record<PaymentMethod, string> = {
  cash: 'Cash',
  eft: 'EFT / bank transfer',
  card: 'Card',
  mobile_payment: 'Mobile payment',
  other: 'Other',
}

export const PAYMENT_STATUS: Record<PaymentStatus, string> = {
  recorded_manually: 'Recorded manually',
  awaiting_confirmation: 'Awaiting confirmation',
  failed: 'Failed',
  cancelled: 'Cancelled',
  confirmed_external: 'Confirmed by provider',
}

export const TRANSACTION_STATUS: Record<TransactionStatus, string> = {
  posted: 'Posted',
  scheduled: 'Scheduled',
  voided: 'Voided',
}

export const SEVERITY: Record<Severity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  informational: 'Info',
}

export const OPPORTUNITY_TYPES: Record<OpportunityType, string> = {
  funding: 'Funding',
  procurement: 'Procurement / tender',
  supplier_registration: 'Supplier registration',
  training: 'Training',
  market_access: 'Market access',
  other: 'Other',
}

export const VERIFICATION: Record<VerificationStatus, string> = {
  verified_official: 'Verified from an official source',
  requires_verification: 'Requires verification',
  sample: 'Sample opportunity',
}

export const APPLICATION_STATUS: Record<ApplicationStatus, string> = {
  saved: 'Saved',
  preparing: 'Preparing',
  applied: 'Applied',
  successful: 'Successful',
  unsuccessful: 'Unsuccessful',
  closed: 'Closed',
}

export const INCIDENT_TYPES: Record<IncidentType, string> = {
  suspicious_payment_request: 'Suspicious payment request',
  fake_proof_of_payment: 'Fake proof of payment',
  bank_detail_change: 'Supplier bank detail change',
  impersonation: 'Impersonation',
  upfront_fee_scam: 'Upfront-fee funding scam',
  phishing: 'Phishing link or message',
  urgent_payment_pressure: 'Urgent payment pressure',
  credential_request: 'Request for PIN / password / OTP',
  other: 'Other',
}

export const INCIDENT_STATUS: Record<IncidentStatus, string> = {
  open: 'Open',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
}

export const BANK_ACCOUNT_STATUS: Record<BankAccountStatus, string> = {
  has_business_account: 'I have a separate business bank account',
  uses_personal_account: 'I use my personal account for the business',
  not_applicable: 'Not applicable / cash only',
}

export function entries<K extends string>(map: Record<K, string>): [K, string][] {
  return Object.entries(map) as [K, string][]
}
