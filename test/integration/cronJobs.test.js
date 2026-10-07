import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../../src/app.js'

// Only the rejection paths — never the valid-secret path, which would
// actually run a real job (send a real digest email, or mutate real
// booking statuses via the auto check-in/out job). Those are covered by
// the manual verification already done this session, not by an automated
// test that would otherwise fire for real on every `npm test` run.
describe('POST /api/cron/:job (auth only, never a real trigger)', () => {
  it('rejects with no secret header', async () => {
    const res = await request(createApp()).post('/api/cron/daily')
    expect(res.status).toBe(401)
  })

  it('rejects a wrong secret', async () => {
    const res = await request(createApp()).post('/api/cron/daily').set('x-cron-secret', 'wrong')
    expect(res.status).toBe(401)
  })

  it('rejects an unknown job name even with the right secret', async () => {
    const res = await request(createApp())
      .post('/api/cron/not-a-real-job')
      .set('x-cron-secret', process.env.CRON_SECRET)
    expect(res.status).toBe(400)
  })
})
