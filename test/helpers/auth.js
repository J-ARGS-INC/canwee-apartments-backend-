import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import { pool } from '../../src/db.js'

// Every row this test suite creates is tagged with this prefix so cleanup
// (both per-test and the safety-net sweep in test/helpers/cleanup.js) can
// find it unambiguously and never touches real operator data.
export const TEST_MARKER = 'vitest-'

export const TEST_PASSWORD = 'Vitest-Test-Password-1!'

// Exercises the real bcrypt + JWT path against a disposable account,
// instead of hand-crafting a token and skipping auth entirely — the point
// is to test the real login route too, not just bypass it.
export async function createTestAdmin({ role = 'admin', isActive = true } = {}) {
  const id = `${TEST_MARKER}${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const hash = await bcrypt.hash(TEST_PASSWORD, 10)
  await pool.query(
    `insert into admin_users (id, display_name, password_hash, role, is_active) values ($1,$2,$3,$4,$5)`,
    [id, `Vitest ${role}`, hash, role, isActive],
  )
  const token = jwt.sign({ sub: id }, process.env.JWT_SECRET, { expiresIn: '1h', algorithm: 'HS256' })
  return { id, password: TEST_PASSWORD, token, role }
}

export async function deleteTestAdmin(id) {
  await pool.query('delete from admin_users where id = $1', [id])
}
