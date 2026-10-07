import 'dotenv/config'

// Never let a test run send a real email, no matter which code path it
// exercises — every send function in src/lib/notify.js checks this exact
// env var and no-ops (just logs a warning) when it's unset.
delete process.env.BREVO_API_KEY

// Deterministic, not whatever happens to be in the real .env — tests must
// not depend on (or risk exercising) the real production cron secret.
process.env.CRON_SECRET = 'vitest-test-secret-do-not-use-in-prod'
