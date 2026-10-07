import { pool } from '../../src/db.js'
import { TEST_MARKER } from './auth.js'

// Safety net, not the primary cleanup mechanism — each test suite deletes
// its own rows in afterEach/afterAll. This catches anything left behind by
// a test that failed before reaching its own cleanup (an assertion threw
// mid-test), so a crashed run still never leaves vitest-* rows behind in
// the real database.
export async function sweepTestData() {
  await pool.query(`delete from audit_log where actor like $1`, [`${TEST_MARKER}%`])
  await pool.query(`delete from bookings where full_name like $1`, [`${TEST_MARKER}%`])
  await pool.query(`delete from expenses where logged_by like $1`, [`${TEST_MARKER}%`])
  await pool.query(`delete from admin_users where id like $1`, [`${TEST_MARKER}%`])
}
