# Tests

Run with `npm test` (single run) or `npm run test:watch` (reruns on save).

## What exists

- **`test/lib/`, `test/middleware/`** — pure unit tests. No database, no network, nothing to clean up. Payment-status math, input validation, audit-log diffing, email template rendering + HTML-escaping, location-hierarchy parsing, notification-recipient merging, and the actual configured rate-limit numbers (fired for real against a throwaway Express app, not just "is a function").
- **`test/integration/`** — real HTTP requests (via `supertest`, wrapping the real `createApp()`) against the **real production database**. There is no separate test database configured for this project.

## Why integration tests run against the real database, and how that's kept safe

Every row an integration test creates is tagged so it can never be mistaken for real operator data and is always cleaned up:

- Test admin accounts: `id` starts with `vitest-` (see `test/helpers/auth.js`).
- Test bookings/expenses: `full_name`/`logged_by` starts with `vitest-` (see `TEST_MARKER` in `test/helpers/auth.js`).
- Each suite deletes its own rows in `afterEach`/`afterAll`.
- `test/helpers/cleanup.js` exports `sweepTestData()`, a safety net for anything a crashed test left behind — not wired into every run automatically (so a leftover row is visible if cleanup ever fails), but safe to run by hand: `node -e "import('./test/helpers/cleanup.js').then(m=>m.sweepTestData())"`.
- `test/setup.js` deletes `BREVO_API_KEY` before any test runs, so no test can ever send a real email — every send function in `src/lib/notify.js` just logs "Email skipped" instead.
- `test/integration/cronJobs.test.js` only tests the auth rejection paths (wrong/missing secret, unknown job name) — it never fires a real job with the correct secret, since that would send a real digest email or run the real nightly check-in/out job against real bookings.

**Never add a test that mutates a real, non-`vitest-`-tagged row.** If a new integration test needs to touch an existing row (not one it created), it should create its own throwaway version of that scenario instead.

## What isn't covered yet

This is a strong foundation on the highest-risk logic (auth, money math, the location hierarchy, cancellation-reason enforcement, rate limits) — not literal 100% line coverage of every route file. `adminAgents.js`, `adminGuests.js`, `adminUsers.js`, `adminSettings.js`, the public `bookings.js`/`contact.js`/`listings.js` routes, `reports.js`, `scheduledReports.js`'s actual digest-sending (content was checked manually, not via an automated test), and the Excel/PDF export routes have no dedicated tests yet. Same pattern (supertest + a throwaway-and-cleanup admin/row) extends to any of these.

## Load testing

`npm run loadtest` (needs the server running separately — `npm run dev` in another terminal first) uses `autocannon` against **read-only endpoints only** (`/api/health`, `/api/listings`), and defaults to `http://localhost:4000` so it can never accidentally hit the live production server. See `loadtest/run.mjs` for why write endpoints are deliberately excluded — load-testing a POST route for real would create real rows and send real emails.

To point it at a real deployed URL on purpose: `LOADTEST_URL=https://canwee-apartments-api.onrender.com npm run loadtest` — expect the first requests to pay Render's cold-start cost if the free-tier service was asleep.
