import { describe, it, expect } from 'vitest'
import { diffFields } from '../../src/lib/auditLog.js'

describe('diffFields', () => {
  it('includes only keys whose value actually changed', () => {
    const before = { ratePerNight: 100000, discount: 0, notes: 'same' }
    const after = { ratePerNight: 120000, discount: 0, notes: 'same' }
    const changes = diffFields(before, after, ['ratePerNight', 'discount', 'notes'])
    expect(changes).toEqual({ ratePerNight: { old: 100000, new: 120000 } })
  })

  it('treats null/undefined/empty-string as equivalent so a no-op edit logs nothing', () => {
    const changes = diffFields({ email: null }, { email: undefined }, ['email'])
    expect(changes).toEqual({})
  })

  it('still reports a real change away from null', () => {
    const changes = diffFields({ email: null }, { email: 'guest@example.com' }, ['email'])
    expect(changes).toEqual({ email: { old: null, new: 'guest@example.com' } })
  })

  it('returns an empty object when nothing in the requested keys changed', () => {
    expect(diffFields({ a: 1 }, { a: 1 }, ['a'])).toEqual({})
  })
})
