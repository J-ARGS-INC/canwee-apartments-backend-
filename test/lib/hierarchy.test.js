import { describe, it, expect } from 'vitest'
import { parseLocationFilter, hierarchyFilterCondition } from '../../src/lib/hierarchy.js'

describe('parseLocationFilter', () => {
  it('parses each valid level', () => {
    expect(parseLocationFilter('location:lagos')).toEqual({ level: 'location', id: 'lagos' })
    expect(parseLocationFilter('area:ikeja')).toEqual({ level: 'area', id: 'ikeja' })
    expect(parseLocationFilter('unit:ikeja-unit-1-lagos')).toEqual({ level: 'unit', id: 'ikeja-unit-1-lagos' })
  })

  it('returns null for anything malformed, unrecognized, or absent', () => {
    for (const bad of [null, undefined, '', 'lagos', 'bogus:lagos', 'location:', 42]) {
      expect(parseLocationFilter(bad)).toBeNull()
    }
  })
})

describe('hierarchyFilterCondition', () => {
  it('returns null (no filter applied) when given no filter', () => {
    const params = []
    expect(hierarchyFilterCondition(null, params, { table: 'bookings', alias: 'l' })).toBeNull()
    expect(params).toEqual([])
  })

  it('filters bookings/listings by location_id, area_id, or the row id itself', () => {
    let params = []
    expect(hierarchyFilterCondition({ level: 'location', id: 'lagos' }, params, { table: 'bookings', alias: 'l' })).toBe('l.location_id = $1')
    expect(params).toEqual(['lagos'])

    params = []
    expect(hierarchyFilterCondition({ level: 'area', id: 'ikeja' }, params, { table: 'bookings', alias: 'l' })).toBe('l.area_id = $1')

    params = []
    expect(hierarchyFilterCondition({ level: 'unit', id: 'ikeja-unit-1-lagos' }, params, { table: 'bookings', alias: 'l' })).toBe('l.id = $1')
  })

  it('filters expenses by their own listing_id column for the unit level, not the row id', () => {
    const params = []
    expect(hierarchyFilterCondition({ level: 'unit', id: 'ikeja-unit-1-lagos' }, params, { table: 'expenses', alias: 'e' })).toBe('e.listing_id = $1')
  })

  it('appends to existing params rather than overwriting, so it composes with other conditions', () => {
    const params = ['2026-10-01']
    const cond = hierarchyFilterCondition({ level: 'location', id: 'lagos' }, params, { table: 'bookings', alias: 'l' })
    expect(cond).toBe('l.location_id = $2')
    expect(params).toEqual(['2026-10-01', 'lagos'])
  })
})
