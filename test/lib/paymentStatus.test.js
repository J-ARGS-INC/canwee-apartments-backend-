import { describe, it, expect } from 'vitest'
import { derivePaymentStatus } from '../../src/lib/paymentStatus.js'

describe('derivePaymentStatus', () => {
  it('is unpaid when nothing has been paid', () => {
    expect(derivePaymentStatus(0, 100000)).toBe('unpaid')
    expect(derivePaymentStatus(-1, 100000)).toBe('unpaid')
  })

  it('is part_payment with no total to compare against', () => {
    expect(derivePaymentStatus(50000, null)).toBe('part_payment')
  })

  it('is part_payment when paid is below total', () => {
    expect(derivePaymentStatus(50000, 100000)).toBe('part_payment')
  })

  it('is paid when paid matches total within a kobo-rounding tolerance', () => {
    expect(derivePaymentStatus(100000, 100000)).toBe('paid')
    expect(derivePaymentStatus(99999.999, 100000)).toBe('paid')
    expect(derivePaymentStatus(100000.009, 100000)).toBe('paid')
  })

  it('is overpaid once paid clearly exceeds total', () => {
    expect(derivePaymentStatus(100001, 100000)).toBe('overpaid')
  })
})
