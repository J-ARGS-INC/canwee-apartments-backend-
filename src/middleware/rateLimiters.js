import rateLimit, { ipKeyGenerator } from 'express-rate-limit'

// Generic IP-based safety net for the public (unauthenticated) routes —
// listings, images, content, analytics. Admin routes are deliberately
// excluded: they already sit behind their own per-admin-id adminLimiter
// (and loginLimiter for signing in), which correctly gives each logged-in
// admin an independent budget. If this IP-based limiter also covered admin
// routes, several admins working from the same office network would still
// end up sharing one bucket here even after adminLimiter was fixed to key
// by identity, since this one runs first and knows nothing about who's
// authenticated.
export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path.startsWith('/admin'),
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

// Applies to authenticated admin API calls (a valid JWT already required —
// this must be mounted AFTER requireAdmin in every admin router so
// req.adminId is already set). Keyed by admin id, not IP: several admins
// often work from the same office network, and keying by IP would put them
// all in one shared bucket, so one busy admin could throttle the others.
// Keying by the verified admin id instead gives every logged-in admin their
// own independent budget regardless of network. Falls back to IP only for
// the never-really-hit case of this running without requireAdmin ahead of it.
export const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many admin requests from this network. Please try again later.' },
  keyGenerator: (req) => req.adminId || ipKeyGenerator(req.ip),
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
