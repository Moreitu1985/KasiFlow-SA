import type { LucideIcon } from 'lucide-react'
import { BanknoteX, Clock, KeyRound, Landmark, Link2Off, Receipt, UserX, Wallet } from 'lucide-react'
import type { IncidentType } from '@/types/api'

export interface FraudTopic {
  type: IncidentType
  title: string
  icon: LucideIcon
  summary: string
  signs: string[]
  steps: string[]
}

/** Education content. Written as decision support: signs to look for and practical checks, not certainties. */
export const FRAUD_TOPICS: FraudTopic[] = [
  {
    type: 'fake_proof_of_payment',
    title: 'Fake proof of payment',
    icon: Receipt,
    summary: 'A customer shows a screenshot, PDF or SMS saying they paid — but the money never arrives.',
    signs: [
      'The customer is in a hurry to collect goods straight after “paying”.',
      'Proof arrives as a screenshot, forwarded SMS or PDF instead of money showing in your account.',
      'Fonts, spacing, bank logo or reference look slightly different from real notifications.',
      'The SMS comes from an ordinary cellphone number, not your bank’s official short code.',
    ],
    steps: [
      'Open your own banking app or check your balance before releasing goods. Only money in your account counts.',
      'Record the sale as “Awaiting confirmation” until you have seen the money yourself.',
      'Remember that “immediate payment” notifications can be faked; an EFT from another bank can also take time to clear.',
      'If in doubt, keep the goods and ask the customer to come back once the money reflects.',
    ],
  },
  {
    type: 'bank_detail_change',
    title: 'Supplier bank details changed',
    icon: Landmark,
    summary: 'You receive a message that a supplier has a “new bank account” — often from someone pretending to be the supplier.',
    signs: [
      'An email, WhatsApp or letter says the supplier’s banking details have changed.',
      'The request comes just before a large payment is due.',
      'The new account is in a different name, or at a different bank, from before.',
      'The message asks you to keep it quiet or to pay urgently.',
    ],
    steps: [
      'Call the supplier on a number you already have — not one given in the message — and confirm the change.',
      'Ask for a bank-stamped confirmation letter for the new account.',
      'Pay a small test amount first and confirm with the supplier that it arrived.',
      'Keep a note of who confirmed the change and when.',
    ],
  },
  {
    type: 'suspicious_payment_request',
    title: 'Suspicious payment requests',
    icon: Wallet,
    summary: 'Requests to pay invoices, fines or “fees” you were not expecting.',
    signs: [
      'An invoice for goods or services you do not remember ordering.',
      'Threats of penalties, legal action or account closure if you do not pay today.',
      'Payment must go to a personal account, voucher or crypto wallet.',
      'The sender refuses to give a landline, address or registration number.',
    ],
    steps: [
      'Check the invoice against your own bills and orders in KasiFlow before paying anything.',
      'Look up the organisation’s official contact details yourself and ask them directly.',
      'Do not pay with vouchers, gift cards or crypto for a business invoice.',
      'If you are unsure, wait. A genuine supplier will still be there tomorrow.',
    ],
  },
  {
    type: 'impersonation',
    title: 'Impersonation',
    icon: UserX,
    summary: 'Someone pretends to be your bank, SARS, a municipality, a supplier, a family member or a big customer.',
    signs: [
      'A familiar name but a new phone number or email address.',
      'Spelling mistakes in a company name or website address.',
      '“Officials” who ask to be paid in cash or into a personal account.',
      'A “relative” or “boss” asking urgently for money or airtime.',
    ],
    steps: [
      'Hang up and call back on the number printed on your card, statement or the official website.',
      'Ask a question only the real person would know the answer to.',
      'Government departments do not collect fees via WhatsApp or into personal accounts.',
      'Tell staff that nobody pays anything on a phone instruction alone.',
    ],
  },
  {
    type: 'upfront_fee_scam',
    title: 'Upfront-fee funding scams',
    icon: BanknoteX,
    summary: 'You are promised a grant or loan — but must first pay a “processing”, “insurance” or “release” fee.',
    signs: [
      'Funding is “guaranteed” or “pre-approved” before you have applied properly.',
      'You must pay a fee before the money can be released.',
      'Contact happens only via WhatsApp, Facebook or a free email address.',
      'Logos of real government agencies or banks used on unofficial pages.',
    ],
    steps: [
      'Do not pay any fee to receive funding. Legitimate funders do not ask for this.',
      'Find the programme on the funder’s official website (for example a .gov.za or the institution’s own domain) and contact them directly.',
      'Keep your ID, bank and company documents private until you have confirmed the funder is real.',
      'Use the Opportunities page to check how an opportunity is verified.',
    ],
  },
  {
    type: 'phishing',
    title: 'Phishing links',
    icon: Link2Off,
    summary: 'Messages with links to fake login pages that steal your banking or email details.',
    signs: [
      'A link that looks almost right but has extra words, numbers or a different ending.',
      'A message saying your account is blocked, a parcel is waiting or you have won something.',
      'A login page reached by clicking a link rather than opening your banking app.',
    ],
    steps: [
      'Do not click links in unexpected SMS, WhatsApp or email messages.',
      'Open your banking app or type the bank’s address yourself.',
      'If you entered details on a suspicious page, call your bank’s official fraud line straight away.',
      'Turn on app notifications so you see every transaction on your account.',
    ],
  },
  {
    type: 'urgent_payment_pressure',
    title: 'Urgent payment pressure',
    icon: Clock,
    summary: 'Pressure to act “right now” is one of the most common signs of fraud.',
    signs: [
      '“Pay in the next 10 minutes or you lose the deal / stock / account.”',
      'Being told not to tell anyone or not to check with your bank.',
      'Being kept on the phone while you make the payment.',
    ],
    steps: [
      'Slow down. Say you will call back, then check independently.',
      'Discuss any unusual payment with someone you trust first.',
      'Use the pre-payment checklist on this page before sending money.',
    ],
  },
  {
    type: 'credential_request',
    title: 'Requests for PINs, passwords or OTPs',
    icon: KeyRound,
    summary: 'Anyone asking for your PIN, password or one-time PIN (OTP) is a serious warning sign.',
    signs: [
      'A caller says they are from your bank and asks you to read out an OTP.',
      'Someone asks for your card PIN “to verify” or “to reverse” a payment.',
      'A request to install a remote-access app on your phone.',
    ],
    steps: [
      'Banks never ask for your PIN, password or OTP. Never share them with anyone.',
      'An OTP is how you approve a transaction — reading it out can approve a payment you did not intend.',
      'End the call and phone your bank on the number on the back of your card.',
      'Change your passwords if you think they were shared.',
    ],
  },
]

export const PRE_PAYMENT_CHECKLIST = [
  'I expected this payment or bill, and it matches what I ordered.',
  'The amount matches the quote, invoice or agreement.',
  'The bank details match the ones I have used before — or I confirmed a change by calling a number I already had.',
  'I am not being rushed or told to keep this secret.',
  'Nobody has asked me for a PIN, password or OTP.',
  'I am not paying a fee to “release” funding, a prize or a parcel.',
  'For money coming in: I have seen it in my own banking app, not just a screenshot or SMS.',
]
