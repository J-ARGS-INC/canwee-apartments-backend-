import { describe, it, expect } from 'vitest'
import { SETTING_DEFAULTS } from '../../src/lib/settings.js'

describe('SETTING_DEFAULTS', () => {
  it('has a safe default for every setting the app reads', () => {
    for (const key of [
      'notify_emails', 'daily_digest_emails', 'weekly_digest_emails', 'monthly_digest_emails',
      'expense_categories', 'payment_methods', 'default_discount_per_night',
    ]) {
      expect(SETTING_DEFAULTS).toHaveProperty(key)
    }
  })

  it('every recipient-list default is an array, never null/undefined', () => {
    for (const key of ['notify_emails', 'daily_digest_emails', 'weekly_digest_emails', 'monthly_digest_emails']) {
      expect(Array.isArray(SETTING_DEFAULTS[key])).toBe(true)
    }
  })

  it('expense_categories and payment_methods ship with real starter options, not empty', () => {
    expect(SETTING_DEFAULTS.expense_categories.length).toBeGreaterThan(0)
    expect(SETTING_DEFAULTS.payment_methods.length).toBeGreaterThan(0)
  })
})
