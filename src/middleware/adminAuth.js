import jwt from 'jsonwebtoken'
import { pool } from '../db.js'

// The JWT only proves "this is a token we signed for this admin id, not
// expired." It does NOT prove the account is still active — a super admin
// deactivating someone must take effect on their very next request, not
// whenever their existing token happens to expire (up to 12h later). So
// every request re-checks admin_users fresh; role also comes from this
// live lookup, never from the token's claims, so a role change takes
// effect immediately too.
export async function requireAdmin(req, res, next) {
  const header = req.headers.authorization || ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''

  if (!token || !process.env.JWT_SECRET) {
    return res.status(401).json({ error: 'Invalid or missing admin credentials.' })
  }

  try {
    // Explicitly pin the algorithm rather than trusting whatever the token
    // header claims — jsonwebtoken already rejects "none", but not pinning
    // this leaves the door open to future algorithm-confusion issues if the
    // signing side ever changes (e.g. to a keypair-based algorithm) without
    // this being updated to match.
    const payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
    const { rows } = await pool.query(
      'select id, display_name, role, is_active from admin_users where id = $1',
      [payload.sub],
    )

    if (rows.length === 0 || !rows[0].is_active) {
      return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' })
    }

    req.adminId = rows[0].id
    req.adminDisplayName = rows[0].display_name
    req.adminRole = rows[0].role
    next()
  } catch {
    return res.status(401).json({ error: 'Invalid or expired session. Please sign in again.' })
  }
}

export function requireSuperAdmin(req, res, next) {
  if (req.adminRole !== 'super_admin') {
    return res.status(403).json({ error: 'Only a super admin can do this.' })
  }
  next()
}
