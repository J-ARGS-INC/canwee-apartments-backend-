import { describe, it, expect } from 'vitest'
import { isValidEmail, isValidDate, requireString, maxLength, escapeHtml } from '../../src/lib/validate.js'

describe('isValidEmail', () => {
  it('accepts ordinary addresses', () => {
    expect(isValidEmail('tomiwa@canweeapartments.com')).toBe(true)
  })
  it('rejects obviously malformed input', () => {
    expect(isValidEmail('not-an-email')).toBe(false)
    expect(isValidEmail('missing@domain')).toBe(false)
    expect(isValidEmail(123)).toBe(false)
    expect(isValidEmail(null)).toBe(false)
  })
})

describe('isValidDate', () => {
  it('accepts a real YYYY-MM-DD date', () => {
    expect(isValidDate('2026-10-07')).toBe(true)
  })
  it('rejects malformed or impossible dates', () => {
    expect(isValidDate('2026-13-01')).toBe(false) // month 13
    expect(isValidDate('10-07-2026')).toBe(false) // wrong order
    expect(isValidDate('not a date')).toBe(false)
    expect(isValidDate(null)).toBe(false)
    expect(isValidDate('')).toBe(false)
  })
})

describe('requireString', () => {
  it('flags missing, blank, and whitespace-only values', () => {
    for (const bad of [undefined, null, '', '   ', 42]) {
      const errors = {}
      requireString(bad, 'fullName', errors)
      expect(errors.fullName).toBe('fullName is required.')
    }
  })
  it('passes a real value through with no error', () => {
    const errors = {}
    requireString('Mr Tobi', 'fullName', errors)
    expect(errors.fullName).toBeUndefined()
  })
})

describe('maxLength', () => {
  it('flags text over the limit, allows text at or under it', () => {
    const errors = {}
    maxLength('a'.repeat(201), 'notes', 200, errors)
    expect(errors.notes).toBe('notes must be 200 characters or fewer.')

    const ok = {}
    maxLength('a'.repeat(200), 'notes', 200, ok)
    expect(ok.notes).toBeUndefined()
  })
  it('ignores non-string values (handled by requireString instead)', () => {
    const errors = {}
    maxLength(undefined, 'notes', 10, errors)
    expect(errors.notes).toBeUndefined()
  })
})

describe('escapeHtml', () => {
  it('escapes every HTML-significant character', () => {
    expect(escapeHtml(`<script>alert("x")</script> & 'single'`)).toBe(
      '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;single&#39;',
    )
  })
  it('treats null/undefined as an empty string instead of throwing', () => {
    expect(escapeHtml(null)).toBe('')
    expect(escapeHtml(undefined)).toBe('')
  })
})
