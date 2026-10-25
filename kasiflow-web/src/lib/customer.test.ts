import { describe, expect, it } from 'vitest'
import {
  accountInput,
  addressLine,
  checkPortfolioFile,
  cleanOtp,
  defaultBarberHours,
  groupCatalogue,
  houseCallsNeedingSafety,
  inviteTokenFrom,
  inviteUrl,
  isEmail,
  isSafetyAlert,
  isValidOtp,
  nextCustomer,
  otpErrorMessage,
  priceDifferences,
  priceFor,
  safeNext,
  safetyActionLabel,
  safetyAlertLink,
  splitCustomerBookings,
  stageActions,
  stageProgress,
  toE164,
  whatsappShareUrl,
} from './customer'
import { canOpenPath } from './access'
import type { CustomerBookingDto } from '@/types/customer'

describe('safeNext', () => {
  it('keeps same-site paths and rejects others', () => {
    expect(safeNext('/p/shop/book?x=1', '/c')).toBe('/p/shop/book?x=1')
    expect(safeNext('//evil.example', '/c')).toBe('/c')
    expect(safeNext('https://evil.example', '/c')).toBe('/c')
    expect(safeNext('/\\evil', '/c')).toBe('/c')
    expect(safeNext(null, '/c')).toBe('/c')
  })
})

describe('inviteTokenFrom', () => {
  it('reads the token from a pasted link or a bare token', () => {
    expect(inviteTokenFrom('https://app.example/join?token=abcDEF123_-xyz789')).toBe('abcDEF123_-xyz789')
    expect(inviteTokenFrom('  Open this: https://x/join?a=1&token=tok%2Ben  ')).toBe('tok+en')
    expect(inviteTokenFrom('abcdefghijklmnop1234')).toBe('abcdefghijklmnop1234')
    expect(inviteTokenFrom('hello')).toBeNull()
    expect(inviteTokenFrom('')).toBeNull()
  })
})

describe('one-time code helpers', () => {
  it('validates codes and emails', () => {
    expect(isValidOtp('123456')).toBe(true)
    expect(isValidOtp('123 456')).toBe(true)
    expect(isValidOtp('12345')).toBe(false)
    expect(isValidOtp('12a456')).toBe(false)
    expect(cleanOtp('12-34 56')).toBe('123456')
    expect(isEmail('thabo@example.co.za')).toBe(true)
    expect(isEmail('thabo@')).toBe(false)
  })

  it('turns SA local numbers into E.164', () => {
    expect(toE164('082 123 4567')).toBe('+27821234567')
    expect(toE164('+27 82 123 4567')).toBe('+27821234567')
    expect(toE164('27821234567')).toBe('+27821234567')
    expect(toE164('12345')).toBeNull()
  })

  it('keeps the rate-limit message from Supabase', () => {
    const m = otpErrorMessage('For security purposes, you can only request this after 42 seconds.', 429)
    expect(m).toContain('Too many codes')
    expect(m).toContain('42 seconds')
    expect(otpErrorMessage('Token has expired or is invalid')).toMatch(/wrong or has expired/)
    expect(otpErrorMessage(undefined)).toBe('Could not complete sign-in. Try again.')
  })
})

describe('account helpers', () => {
  it('turns blank fields into null and joins addresses', () => {
    const input = accountInput({ fullName: ' Thabo ', contactPhone: '', addressLine: '12 Vilakazi St', suburb: ' ', town: 'Soweto', accessNotes: '' })
    expect(input).toEqual({ fullName: 'Thabo', contactPhone: null, addressLine: '12 Vilakazi St', suburb: null, town: 'Soweto', accessNotes: null })
    expect(addressLine({ addressLine: '12 Vilakazi St', suburb: null, town: 'Soweto' })).toBe('12 Vilakazi St, Soweto')
  })

  it('splits bookings into upcoming and past', () => {
    const now = Date.parse('2026-10-16T10:00:00Z')
    const mk = (reference: string, startsAt: string, status: CustomerBookingDto['status'] = 'confirmed'): CustomerBookingDto => ({
      reference,
      businessName: 'Shop',
      slug: 'shop',
      status,
      statusLabel: status,
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + 30 * 60_000).toISOString(),
      staffName: null,
      locationType: 'in_shop',
      servicesSummary: 'Haircut',
      totalCents: 8000,
      needsYourAnswer: false,
    })
    const { upcoming, past } = splitCustomerBookings(
      [mk('B', '2026-10-18T09:00:00Z'), mk('A', '2026-10-17T09:00:00Z'), mk('OLD', '2026-10-01T09:00:00Z'), mk('X', '2026-10-20T09:00:00Z', 'cancelled')],
      now,
    )
    expect(upcoming.map((b) => b.reference)).toEqual(['A', 'B'])
    expect(past.map((b) => b.reference)).toEqual(['X', 'OLD'])
  })
})

describe('catalogue', () => {
  const services = [
    { id: '1', name: 'Haircut', category: 'Hair', priceCents: 8000 },
    { id: '2', name: 'Beard trim', category: 'Beard', priceCents: 5000 },
    { id: '3', name: 'Fade', category: 'hair', priceCents: 10000 },
    { id: '4', name: 'Kids cut', category: null, priceCents: 6000 },
  ]

  it('groups by category in first-seen order with uncategorised last', () => {
    const g = groupCatalogue(services)
    expect(g.map((x) => x.category)).toEqual(['Hair', 'Beard', 'Other'])
    expect(g[0].items.map((x) => x.id)).toEqual(['1', '3'])
    expect(groupCatalogue([services[3]]).map((x) => x.category)).toEqual(['Services'])
  })

  it('lists only prices that differ from the list price', () => {
    const diffs = priceDifferences(
      [
        { serviceId: '1', priceCents: 8000 },
        { serviceId: '3', priceCents: 12000 },
        { serviceId: 'missing', priceCents: 1 },
      ],
      services,
    )
    expect(diffs).toEqual([{ serviceId: '3', name: 'Fade', priceCents: 12000, listPriceCents: 10000 }])
    expect(priceFor('3', 10000, [{ serviceId: '3', priceCents: 12000 }])).toBe(12000)
    expect(priceFor('2', 5000, null)).toBe(5000)
  })
})

describe('barber registration', () => {
  it('defaults to Monday to Saturday 08:00–18:00', () => {
    const h = defaultBarberHours()
    expect(h).toHaveLength(6)
    expect(h.map((x) => x.weekday)).toEqual([1, 2, 3, 4, 5, 6])
    expect(h.every((x) => x.start === '08:00' && x.end === '18:00')).toBe(true)
  })

  it('builds an absolute invite link and a WhatsApp share link', () => {
    const link = inviteUrl('https://app.kasiflow.co.za/', '/join?token=abc')
    expect(link).toBe('https://app.kasiflow.co.za/join?token=abc')
    const wa = whatsappShareUrl('Hi Sipho, your link:', link)
    expect(wa.startsWith('https://wa.me/?text=')).toBe(true)
    expect(decodeURIComponent(wa.slice('https://wa.me/?text='.length))).toBe(`Hi Sipho, your link:\n\n${link}`)
    expect(whatsappShareUrl('', link)).toBe(`https://wa.me/?text=${encodeURIComponent(link)}`)
  })

  it('register-barber route needs manageStaff', () => {
    expect(canOpenPath(['manageStaff'], '/team/register')).toBe(true)
    expect(canOpenPath(['workOwnBookings'], '/team/register')).toBe(false)
  })
})

describe('house-call safety', () => {
  it('labels check-ins and orders step actions', () => {
    expect(safetyActionLabel('departed')).toBe('Left for the visit')
    expect(safetyActionLabel('returned')).toBe('Back safely')
    expect(safetyActionLabel('help')).toBe('I need help')
    expect(safetyActionLabel('unknown')).toBe('unknown')
    expect(stageActions(['help', 'arrived', 'departed'])).toEqual(['departed', 'arrived'])
    expect(stageProgress('not_started')).toBe(0)
    expect(stageProgress('finished')).toBe(3)
  })

  it('recognises safety alerts and links them to the booking', () => {
    expect(isSafetyAlert('HOUSE_CALL_HELP')).toBe(true)
    expect(isSafetyAlert('HOUSE_CALL_OVERDUE')).toBe(true)
    expect(isSafetyAlert('DUPLICATE_PAYMENT')).toBe(false)
    expect(safetyAlertLink('HOUSE_CALL_HELP', 'booking', 'abc')).toBe('/bookings/abc')
    expect(safetyAlertLink('HOUSE_CALL_HELP', null, 'abc')).toBe('/bookings/abc')
    expect(safetyAlertLink('DUPLICATE_PAYMENT', 'booking', 'abc')).toBeNull()
  })

  it('picks the barber’s house calls and the next customer', () => {
    const now = Date.parse('2026-10-16T10:00:00Z')
    const today = [
      { id: 'a', locationType: 'house_call', status: 'confirmed', staffId: 's1', startsAt: '2026-10-16T08:00:00Z', endsAt: '2026-10-16T08:30:00Z' },
      { id: 'b', locationType: 'in_shop', status: 'confirmed', staffId: 's1', startsAt: '2026-10-16T11:00:00Z', endsAt: '2026-10-16T11:30:00Z' },
      { id: 'c', locationType: 'house_call', status: 'requested', staffId: 's1', startsAt: '2026-10-16T12:00:00Z', endsAt: '2026-10-16T12:30:00Z' },
      { id: 'd', locationType: 'house_call', status: 'confirmed', staffId: 's2', startsAt: '2026-10-16T13:00:00Z', endsAt: '2026-10-16T13:30:00Z' },
    ]
    expect(houseCallsNeedingSafety(today, 's1').map((b) => b.id)).toEqual(['a'])
    expect(nextCustomer(today, now)?.id).toBe('b')
    expect(nextCustomer([], now)).toBeNull()
  })
})

describe('portfolio files', () => {
  it('accepts small JPEG/PNG/WebP only', () => {
    expect(checkPortfolioFile(null)).toMatch(/Choose/)
    expect(checkPortfolioFile({ type: 'image/gif', size: 10 })).toMatch(/JPEG/)
    expect(checkPortfolioFile({ type: 'image/png', size: 4 * 1024 * 1024 })).toMatch(/3 MB/)
    expect(checkPortfolioFile({ type: 'image/webp', size: 1000 })).toBeNull()
  })
})
