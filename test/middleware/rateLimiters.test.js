import { describe, it, expect } from 'vitest'
import express from 'express'
import request from 'supertest'
import { loginLimiter, bookingLookupLimiter, createSubmissionLimiter } from '../../src/middleware/rateLimiters.js'

// Fires real requests through each limiter (wrapped in a throwaway Express
// app, not the real server) to verify the actual configured numbers —
// express-rate-limit doesn't expose its config for introspection, so
// behavior is the only way to check it. If someone loosens
// loginLimiter's budget in rateLimiters.js, this is what catches it.
function appWith(limiter) {
  const app = express()
  app.use(limiter)
  app.get('/', (req, res) => res.json({ ok: true }))
  return app
}

describe('rate limiter configuration (behavioral, not just "is a function")', () => {
  it('loginLimiter allows exactly 8 requests per window, then blocks', async () => {
    const app = appWith(loginLimiter)
    for (let i = 0; i < 8; i++) {
      const res = await request(app).get('/')
      expect(res.status, `request ${i + 1} of 8 should pass`).toBe(200)
    }
    const blocked = await request(app).get('/')
    expect(blocked.status).toBe(429)
  })

  it('bookingLookupLimiter allows exactly 20 requests per window, then blocks', async () => {
    const app = appWith(bookingLookupLimiter)
    for (let i = 0; i < 20; i++) {
      const res = await request(app).get('/')
      expect(res.status).toBe(200)
    }
    const blocked = await request(app).get('/')
    expect(blocked.status).toBe(429)
  })

  it('createSubmissionLimiter returns an independent instance per call, so two routes never share one budget', async () => {
    const limiterA = createSubmissionLimiter()
    const limiterB = createSubmissionLimiter()
    const appA = appWith(limiterA)
    const appB = appWith(limiterB)
    // Exhaust A's budget (10/hour) — B must be unaffected since it's a
    // separate instance, even though both would share one bucket if this
    // were a single shared limiter reused across routes (a real bug this
    // project hit and fixed once already).
    for (let i = 0; i < 10; i++) await request(appA).get('/')
    expect((await request(appA).get('/')).status).toBe(429)
    expect((await request(appB).get('/')).status).toBe(200)
  })
})
