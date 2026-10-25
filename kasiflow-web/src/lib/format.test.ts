import { describe, expect, it } from 'vitest'
import { addDays, centsToRandInput, formatRandShort, formatZAR, parseRandToCents } from './format'

describe('formatZAR', () => {
  it.each([
    [150000, 'R1,500.00'],
    [-25000, '-R250.00'],
    [5, 'R0.05'],
    [0, 'R0.00'],
    [123456789, 'R1,234,567.89'],
  ])('formats %i cents as %s', (cents, expected) => {
    expect(formatZAR(cents)).toBe(expected)
  })
})

describe('parseRandToCents', () => {
  it('parses rand strings without floating-point errors', () => {
    expect(parseRandToCents('1500.50')).toBe(150050)
    expect(parseRandToCents('4.35')).toBe(435)
    expect(parseRandToCents('0.1')).toBe(10)
    expect(parseRandToCents('R1,500')).toBe(150000)
  })

  it('rejects invalid or negative input by default', () => {
    expect(parseRandToCents('abc')).toBeNull()
    expect(parseRandToCents('')).toBeNull()
    expect(parseRandToCents('-5')).toBeNull()
    expect(parseRandToCents('1.234')).toBeNull()
  })

  it('round-trips with centsToRandInput', () => {
    for (const c of [1, 99, 100, 150050, 999999]) {
      expect(parseRandToCents(centsToRandInput(c))).toBe(c)
    }
  })
})

describe('addDays', () => {
  it('adds calendar days across month ends', () => {
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
  })
})

describe('formatRandShort', () => {
  it('drops zero cents only', () => {
    expect(formatRandShort(4000)).toBe('R40')
    expect(formatRandShort(4250)).toBe('R42.50')
    expect(formatRandShort(null)).toBe('—')
  })
})
