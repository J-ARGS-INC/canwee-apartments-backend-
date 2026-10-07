import { describe, it, expect, afterAll } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { createTestAdmin, deleteTestAdmin, TEST_MARKER } from '../helpers/auth.js'
import { pool } from '../../src/db.js'

// Dates far enough in the future that they will never collide with real
// operational bookings for this unit, and distinct per test run.
const UNIQUE = Date.now()
function futureDates(offsetDays) {
  const d = new Date()
  d.setDate(d.getDate() + 365 + offsetDays) // a year out — safely clear of real bookings
  const ci = d.toISOString().slice(0, 10)
  d.setDate(d.getDate() + 2)
  const co = d.toISOString().slice(0, 10)
  return { checkIn: ci, checkOut: co }
}

describe('admin booking creation + status transitions', () => {
  let admin, superAdmin
  const createdBookingIds = []

  afterAll(async () => {
    if (createdBookingIds.length) {
      await pool.query('delete from audit_log where entity_id = any($1)', [createdBookingIds])
      await pool.query('delete from bookings where id = any($1)', [createdBookingIds])
    }
    if (admin) await deleteTestAdmin(admin.id)
    if (superAdmin) await deleteTestAdmin(superAdmin.id)
  })

  it('sets up test admin accounts', async () => {
    admin = await createTestAdmin({ role: 'admin' })
    superAdmin = await createTestAdmin({ role: 'super_admin' })
    expect(admin.token).toBeTruthy()
  })

  it('creates a booking with correct total = nights * rate - discount', async () => {
    const { checkIn, checkOut } = futureDates(0)
    const res = await request(createApp())
      .post('/api/admin/bookings')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        listingId: 'ikeja-unit-1-lagos',
        fullName: `${TEST_MARKER}guest-${UNIQUE}`,
        phone: '08000000000',
        checkIn, checkOut, // 2 nights
        ratePerNight: 100000,
        discount: 20000,
      })
    expect(res.status).toBe(201)
    expect(res.body.status).toBe('pending')
    createdBookingIds.push(res.body.id)

    const { rows } = await pool.query('select total_amount, amount_paid, payment_status from bookings where id = $1', [res.body.id])
    expect(Number(rows[0].total_amount)).toBe(2 * 100000 - 20000)
    // A brand-new booking never starts pre-paid, regardless of what the
    // request sends — amount_paid only ever moves via the payments route.
    expect(Number(rows[0].amount_paid)).toBe(0)
    expect(rows[0].payment_status).toBe('unpaid')
  })

  it('rejects a second booking that overlaps the same unit and dates', async () => {
    const { checkIn, checkOut } = futureDates(0) // identical to the booking above
    const res = await request(createApp())
      .post('/api/admin/bookings')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        listingId: 'ikeja-unit-1-lagos',
        fullName: `${TEST_MARKER}guest-overlap-${UNIQUE}`,
        phone: '08000000001',
        checkIn, checkOut,
        ratePerNight: 100000,
      })
    expect(res.status).toBe(409)
  })

  it('rejects a discount larger than the room total with a clean 400, not a raw DB error', async () => {
    const { checkIn, checkOut } = futureDates(10)
    const res = await request(createApp())
      .post('/api/admin/bookings')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        listingId: 'ikeja-unit-1-lagos',
        fullName: `${TEST_MARKER}guest-baddiscount-${UNIQUE}`,
        phone: '08000000002',
        checkIn, checkOut,
        ratePerNight: 100000,
        discount: 999999999,
      })
    expect(res.status).toBe(400)
    expect(res.body.fields?.discount).toBeTruthy()
  })

  it('a regular admin cannot cancel without a reason; a super admin can', async () => {
    const { checkIn, checkOut } = futureDates(20)
    const createRes = await request(createApp())
      .post('/api/admin/bookings')
      .set('Authorization', `Bearer ${admin.token}`)
      .send({
        listingId: 'ikeja-unit-2-lagos',
        fullName: `${TEST_MARKER}guest-cancel-${UNIQUE}`,
        phone: '08000000003',
        checkIn, checkOut,
        ratePerNight: 100000,
        status: 'confirmed',
      })
    expect(createRes.status).toBe(201)
    createdBookingIds.push(createRes.body.id)
    const bookingId = createRes.body.id

    const noReasonRes = await request(createApp())
      .patch(`/api/admin/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ action: 'cancel' })
    expect(noReasonRes.status).toBe(400)

    const withReasonRes = await request(createApp())
      .patch(`/api/admin/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ action: 'cancel', reason: 'Vitest test cancellation' })
    expect(withReasonRes.status).toBe(200)
    expect(withReasonRes.body.status).toBe('cancelled')

    const { rows } = await pool.query('select cancellation_reason, cancelled_by from bookings where id = $1', [bookingId])
    expect(rows[0].cancellation_reason).toBe('Vitest test cancellation')
    expect(rows[0].cancelled_by).toBe(admin.id)
  })

  it('a super admin can cancel a different booking with no reason at all', async () => {
    const { checkIn, checkOut } = futureDates(30)
    const createRes = await request(createApp())
      .post('/api/admin/bookings')
      .set('Authorization', `Bearer ${superAdmin.token}`)
      .send({
        listingId: 'ikeja-unit-2-lagos',
        fullName: `${TEST_MARKER}guest-supercancel-${UNIQUE}`,
        phone: '08000000004',
        checkIn, checkOut,
        ratePerNight: 100000,
        status: 'confirmed',
      })
    createdBookingIds.push(createRes.body.id)

    const res = await request(createApp())
      .patch(`/api/admin/bookings/${createRes.body.id}`)
      .set('Authorization', `Bearer ${superAdmin.token}`)
      .send({ action: 'cancel' })
    expect(res.status).toBe(200)
  })

  it('rejects an illegal status transition (cancelled booking cannot be checked in)', async () => {
    const target = createdBookingIds[createdBookingIds.length - 1] // the one just cancelled above
    const res = await request(createApp())
      .patch(`/api/admin/bookings/${target}`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ action: 'check-in' })
    expect(res.status).toBe(409)
  })
})
