import 'dotenv/config'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { pool } from '../src/db.js'

// One-time (or rerun-safe) setup for the initial admin accounts. Passwords
// are randomly generated here and printed ONCE to the console — they are
// never stored in plaintext anywhere, only as a bcrypt hash in the DB.
// Save the printed passwords somewhere safe; there is no recovery if lost,
// only resetting (rerunning this script regenerates all of them).
//
// admin-super001 can create/deactivate other admin accounts from the
// Admins tab; admin-user001/002/003 cannot — regular admin accounts, same
// booking/expense/payment access as before, just individually attributed.
const ADMINS = [
  { id: 'admin-super001', displayName: 'Super Admin', role: 'super_admin' },
  { id: 'admin-user001', displayName: 'Admin 001', role: 'admin' },
  { id: 'admin-user002', displayName: 'Admin 002', role: 'admin' },
  { id: 'admin-user003', displayName: 'Admin 003', role: 'admin' },
]

function generatePassword() {
  return crypto.randomBytes(9).toString('base64url')
}

async function main() {
  console.log('Admin credentials (save these now, shown only once):\n')

  for (const admin of ADMINS) {
    const password = generatePassword()
    const hash = await bcrypt.hash(password, 12)

    await pool.query(
      `insert into admin_users (id, display_name, password_hash, role)
       values ($1,$2,$3,$4)
       on conflict (id) do update set password_hash = excluded.password_hash, display_name = excluded.display_name, role = excluded.role`,
      [admin.id, admin.displayName, hash, admin.role],
    )

    console.log(`  ${admin.id}  /  ${password}  (${admin.role})`)
  }

  console.log('\nLog in at /2889bc29ed60/admin with any of the above.')
  await pool.end()
}

main().catch((err) => {
  console.error('Admin seed failed:', err)
  process.exit(1)
})
