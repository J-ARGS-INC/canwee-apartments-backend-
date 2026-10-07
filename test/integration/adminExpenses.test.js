import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { createTestAdmin, deleteTestAdmin, TEST_MARKER } from '../helpers/auth.js'
import { pool } from '../../src/db.js'

describe('admin expense creation at every hierarchy depth', () => {
  let admin
  const createdExpenseIds = []

  afterAll(async () => {
    if (createdExpenseIds.length) {
      await pool.query('delete from audit_log where entity_id = any($1)', [createdExpenseIds])
      await pool.query('delete from expenses where id = any($1)', [createdExpenseIds])
    }
    if (admin) await deleteTestAdmin(admin.id)
  })

  it('sets up a test admin', async () => {
    admin = await createTestAdmin({ role: 'admin' })
    expect(admin.token).toBeTruthy()
  })

  it('creates a location-level ("general") expense and resolves area/listing to null', async () => {
    const res = await request(createApp())
      .post('/api/admin/expenses')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ category: 'Utilities', amount: 1000, locationId: 'abeokuta', loggedBy: TEST_MARKER })
    expect(res.status).toBe(201)
    createdExpenseIds.push(res.body.id)

    const { rows } = await pool.query('select location_id, area_id, listing_id from expenses where id = $1', [res.body.id])
    expect(rows[0]).toEqual({ location_id: 'abeokuta', area_id: null, listing_id: null })
  })

  it('creates an area-level ("general") expense and derives its parent location automatically', async () => {
    const res = await request(createApp())
      .post('/api/admin/expenses')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ category: 'Utilities', amount: 2000, areaId: 'ikeja', loggedBy: TEST_MARKER })
    expect(res.status).toBe(201)
    createdExpenseIds.push(res.body.id)

    const { rows } = await pool.query('select location_id, area_id, listing_id from expenses where id = $1', [res.body.id])
    expect(rows[0]).toEqual({ location_id: 'lagos', area_id: 'ikeja', listing_id: null })
  })

  it('creates a unit-level expense and derives both its area and location automatically', async () => {
    const res = await request(createApp())
      .post('/api/admin/expenses')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ category: 'Utilities', amount: 3000, listingId: 'ikeja-unit-1-lagos', loggedBy: TEST_MARKER })
    expect(res.status).toBe(201)
    createdExpenseIds.push(res.body.id)

    const { rows } = await pool.query('select location_id, area_id, listing_id from expenses where id = $1', [res.body.id])
    expect(rows[0]).toEqual({ location_id: 'lagos', area_id: 'ikeja', listing_id: 'ikeja-unit-1-lagos' })
  })

  it('rejects an expense with no location/area/listing at all — "General/no location" no longer exists', async () => {
    const res = await request(createApp())
      .post('/api/admin/expenses')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ category: 'Utilities', amount: 1000, loggedBy: TEST_MARKER })
    expect(res.status).toBe(400)
    expect(res.body.fields?.locationId).toBeTruthy()
  })

  it('rejects a listingId that does not exist, instead of a raw FK-violation 500', async () => {
    const res = await request(createApp())
      .post('/api/admin/expenses')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ category: 'Utilities', amount: 1000, listingId: 'does-not-exist', loggedBy: TEST_MARKER })
    expect(res.status).toBe(400)
    expect(res.body.fields?.listingId).toBeTruthy()
  })

  it('rejects an expense with no category or a non-positive amount', async () => {
    const res = await request(createApp())
      .post('/api/admin/expenses')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ amount: -5, locationId: 'abeokuta' })
    expect(res.status).toBe(400)
    expect(res.body.fields?.category).toBeTruthy()
    expect(res.body.fields?.amount).toBeTruthy()
  })
})

describe('GET /api/admin/locations (the Location -> Area -> Unit tree)', () => {
  it('returns Lagos with Ikeja/Gbagada areas, and Abeokuta with units directly (no areas)', async () => {
    const admin = await createTestAdmin({ role: 'admin' })
    try {
      const res = await request(createApp()).get('/api/admin/locations').set('Authorization', `Bearer ${admin.token}`)
      expect(res.status).toBe(200)
      const lagos = res.body.find((l) => l.id === 'lagos')
      const abeokuta = res.body.find((l) => l.id === 'abeokuta')
      expect(lagos.areas.map((a) => a.id).sort()).toEqual(['gbagada', 'ikeja'])
      expect(abeokuta.areas).toEqual([])
      expect(abeokuta.units.length).toBeGreaterThan(0)
    } finally {
      await deleteTestAdmin(admin.id)
    }
  })
})
