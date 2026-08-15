import { pool } from '../db.js'

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/
const POLL_INTERVAL_MS = 150
const MAX_POLL_MS = 5000
// A claimed key whose handler never finished (a rare uncaught crash, not a
// normal error path — those go through the res.json override below like
// anything else) is abandoned after this long, so one dead request can't
// permanently jam a key for every future retry.
const STALE_CLAIM_MS = 30_000

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Client sends an `Idempotency-Key` header (any UUID/random token it
// generates once per logical submission attempt, e.g. when a booking/
// payment form is opened, regenerated after each successful submit). A
// retried or double-fired request with the same key replays the original
// response instead of re-running the handler. Requests without the header
// pass through unchanged — the header is optional, not required.
export function idempotent() {
  return async (req, res, next) => {
    const key = req.get('Idempotency-Key')
    if (!key) return next()

    if (!KEY_PATTERN.test(key)) {
      return res.status(400).json({ error: 'Invalid Idempotency-Key header.' })
    }

    try {
      // Atomically claim the key BEFORE any business logic runs. This is
      // what actually closes the race: two requests arriving milliseconds
      // apart both reach this INSERT, but the unique constraint on `key`
      // lets only one of them win it — the loser's insert is a no-op
      // (`on conflict do nothing` returns zero rows), so only the winner
      // ever proceeds to next() and touches the database for real.
      const { rows: claimed } = await pool.query(
        `insert into idempotency_keys (key) values ($1) on conflict (key) do nothing returning key`,
        [key],
      )

      if (claimed.length === 0) {
        if (await reclaimIfStale(key)) {
          // Won the reclaim — proceed as if we'd claimed it fresh.
        } else {
          return await waitForResult(key, res)
        }
      }
    } catch (err) {
      return next(err)
    }

    const originalJson = res.json.bind(res)
    res.json = (body) => {
      if (res.statusCode < 500) {
        pool
          .query('update idempotency_keys set status_code = $2, response = $3 where key = $1', [key, res.statusCode, body])
          .catch((err) => console.error('Failed to store idempotency response:', err))
      } else {
        // A 500 means this attempt failed for an infrastructure reason,
        // not because the action actually happened — release the claim so
        // a genuine retry with the same key can really re-attempt it,
        // instead of finding a permanently-empty result to poll for.
        pool.query('delete from idempotency_keys where key = $1', [key]).catch((err) => console.error('Failed to release idempotency key:', err))
      }
      return originalJson(body)
    }

    next()
  }
}

async function reclaimIfStale(key) {
  const { rows } = await pool.query(
    `delete from idempotency_keys
     where key = $1 and status_code is null and created_at < now() - interval '${STALE_CLAIM_MS} milliseconds'
     returning key`,
    [key],
  )
  if (rows.length === 0) return false
  const { rows: reclaimed } = await pool.query(
    `insert into idempotency_keys (key) values ($1) on conflict (key) do nothing returning key`,
    [key],
  )
  return reclaimed.length > 0
}

async function waitForResult(key, res) {
  const deadline = Date.now() + MAX_POLL_MS
  while (Date.now() < deadline) {
    const { rows } = await pool.query('select status_code, response from idempotency_keys where key = $1', [key])
    if (rows[0]?.status_code != null) {
      return res.status(rows[0].status_code).json(rows[0].response)
    }
    if (rows.length === 0) break // the in-flight request errored and released the claim; fall through
    await sleep(POLL_INTERVAL_MS)
  }
  return res.status(409).json({
    error: 'This request is still being processed. Please wait a moment before trying again.',
  })
}
