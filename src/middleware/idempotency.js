import { pool } from '../db.js'

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/

// Client sends an `Idempotency-Key` header (any UUID/random token it
// generates once per logical submission, e.g. when the booking form first
// mounts). A retried request with the same key replays the original
// response instead of re-inserting a row. Requests without the header pass
// through unchanged — the header is optional, not required, so older
// clients or direct API callers still work.
export function idempotent() {
  return async (req, res, next) => {
    const key = req.get('Idempotency-Key')
    if (!key) return next()

    if (!KEY_PATTERN.test(key)) {
      return res.status(400).json({ error: 'Invalid Idempotency-Key header.' })
    }

    try {
      const { rows } = await pool.query(
        'select status_code, response from idempotency_keys where key = $1',
        [key],
      )
      if (rows.length > 0) {
        return res.status(rows[0].status_code).json(rows[0].response)
      }
    } catch (err) {
      return next(err)
    }

    const originalJson = res.json.bind(res)
    res.json = (body) => {
      if (res.statusCode < 500) {
        pool
          .query(
            `insert into idempotency_keys (key, status_code, response) values ($1,$2,$3)
             on conflict (key) do nothing`,
            [key, res.statusCode, body],
          )
          .catch((err) => console.error('Failed to store idempotency key:', err))
      }
      return originalJson(body)
    }

    next()
  }
}
