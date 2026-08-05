import rateLimit from 'express-rate-limit'

// Generic safety net across every /api route.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
})

// Booking/contact submissions are cheap to spam and expensive to read
// (each one triggers an email) — keep this tight. A factory rather than a
// shared instance so the two routes don't eat into each other's quota.
export function createSubmissionLimiter() {
  return rateLimit({
    windowMs: 60 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many submissions from this network. Please try again later.' },
  })
}

// Applies to authenticated admin API calls (a valid JWT already required).
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests from this network. Please try again later.' },
})

// Login attempts guess a real (human-generated, guessable) password rather
// than a 48-char random key, so this needs to be much tighter than the
// general admin limiter — slows down credential-stuffing/brute-force
// significantly more per unit time.
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please try again later.' },
})
