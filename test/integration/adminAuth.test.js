import { describe, it, expect, afterEach } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'
import { createTestAdmin, deleteTestAdmin, TEST_PASSWORD } from '../helpers/auth.js'

describe('admin login + session verification', () => {
  let cleanupId = null
  afterEach(async () => {
    if (cleanupId) await deleteTestAdmin(cleanupId)
    cleanupId = null
  })

  it('rejects a login with no username/password', async () => {
    const res = await request(createApp()).post('/api/admin/login').send({})
    expect(res.status).toBe(400)
  })

  it('rejects a wrong password for a real account', async () => {
    const admin = await createTestAdmin({ role: 'admin' })
    cleanupId = admin.id
    const res = await request(createApp()).post('/api/admin/login').send({ username: admin.id, password: 'wrong-password' })
    expect(res.status).toBe(401)
  })

  it('rejects login for a username that does not exist, with the same message as a wrong password (no account enumeration)', async () => {
    const res = await request(createApp()).post('/api/admin/login').send({ username: 'no-such-admin-vitest', password: 'anything' })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe('Invalid username or password.')
  })

  it('logs a real admin in and issues a token that /verify accepts', async () => {
    const admin = await createTestAdmin({ role: 'admin' })
    cleanupId = admin.id
    const app = createApp()

    const loginRes = await request(app).post('/api/admin/login').send({ username: admin.id, password: TEST_PASSWORD })
    expect(loginRes.status).toBe(200)
    expect(loginRes.body.token).toBeTruthy()
    expect(loginRes.body.role).toBe('admin')

    const verifyRes = await request(app).get('/api/admin/verify').set('Authorization', `Bearer ${loginRes.body.token}`)
    expect(verifyRes.status).toBe(200)
    expect(verifyRes.body.adminId).toBe(admin.id)
  })

  it('a deactivated account cannot log in even with the correct password', async () => {
    const admin = await createTestAdmin({ role: 'admin', isActive: false })
    cleanupId = admin.id
    const res = await request(createApp()).post('/api/admin/login').send({ username: admin.id, password: TEST_PASSWORD })
    expect(res.status).toBe(401)
  })

  it('a regular admin is rejected by requireSuperAdmin-gated routes', async () => {
    const admin = await createTestAdmin({ role: 'admin' })
    cleanupId = admin.id
    const res = await request(createApp()).get('/api/admin/audit-log').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(403)
  })

  it('a super admin passes the same requireSuperAdmin-gated route', async () => {
    const admin = await createTestAdmin({ role: 'super_admin' })
    cleanupId = admin.id
    const res = await request(createApp()).get('/api/admin/audit-log').set('Authorization', `Bearer ${admin.token}`)
    expect(res.status).toBe(200)
  })

  it('a bearer token for an already-deactivated account is rejected, even if the token itself is validly signed', async () => {
    const admin = await createTestAdmin({ role: 'admin' })
    cleanupId = admin.id
    const app = createApp()
    // Token was issued while active...
    const token = admin.token
    expect((await request(app).get('/api/admin/verify').set('Authorization', `Bearer ${token}`)).status).toBe(200)
    // ...then deactivated out from under it (no new login, same token) —
    // this is the exact "immediate effect" guarantee requireAdmin exists
    // to provide: it re-checks is_active from the DB on every request,
    // never trusting the JWT's claims alone.
    const { pool } = await import('../../src/db.js')
    await pool.query('update admin_users set is_active = false where id = $1', [admin.id])
    const res = await request(app).get('/api/admin/verify').set('Authorization', `Bearer ${token}`)
    expect(res.status).toBe(401)
  })
})
