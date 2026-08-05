import { Router } from 'express'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { pool } from '../db.js'
import { requireAdmin, requireSuperAdmin } from '../middleware/adminAuth.js'
import { adminLimiter } from '../middleware/rateLimiters.js'
import { logAudit } from '../lib/auditLog.js'

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,49}$/

function generatePassword() {
  return crypto.randomBytes(9).toString('base64url')
}

const router = Router()

router.use(adminLimiter)
router.use(requireAdmin)
router.use(requireSuperAdmin)

router.get('/', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'select id, display_name, role, is_active, created_at from admin_users order by created_at',
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

router.post('/', async (req, res, next) => {
  try {
    const { id, displayName, role } = req.body ?? {}

    const errors = {}
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
      errors.id = 'Use 3-50 lowercase letters, numbers, or hyphens (e.g. admin-user004).'
    }
    if (role && role !== 'admin' && role !== 'super_admin') {
      errors.role = 'Role must be "admin" or "super_admin".'
    }
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: errors })
    }

    const { rows: existing } = await pool.query('select id from admin_users where id = $1', [id])
    if (existing.length > 0) {
      return res.status(409).json({ error: `"${id}" already exists.` })
    }

    const password = generatePassword()
    const hash = await bcrypt.hash(password, 12)

    await pool.query(
      'insert into admin_users (id, display_name, password_hash, role) values ($1,$2,$3,$4)',
      [id, displayName || id, hash, role || 'admin'],
    )

    logAudit({
      entityType: 'admin_user',
      entityId: id,
      action: 'create',
      changes: { displayName: displayName || id, role: role || 'admin' },
      actor: req.adminId,
    })

    // The plaintext password is only ever available in this one response —
    // it is never stored anywhere, only its bcrypt hash. Hand it to the new
    // admin now; there's no way to retrieve it again later, only reset it.
    res.status(201).json({ id, password, displayName: displayName || id, role: role || 'admin' })
  } catch (err) {
    // Covers the race where two requests for the same new username both
    // pass the earlier existence check before either finishes inserting —
    // the primary key still stops the duplicate, this just turns Postgres's
    // raw error into the same clean 409 the normal path returns.
    if (err.code === '23505') return res.status(409).json({ error: `"${req.body?.id}" already exists.` })
    next(err)
  }
})

router.patch('/:id/deactivate', async (req, res, next) => {
  try {
    const { id } = req.params
    const reason = req.body?.reason

    if (id === req.adminId) {
      return res.status(400).json({ error: "You can't deactivate your own account." })
    }
    if (typeof reason !== 'string' || !reason.trim()) {
      return res.status(400).json({ error: 'Validation failed', fields: { reason: 'Enter a reason for the edit.' } })
    }

    const { rows } = await pool.query(
      'update admin_users set is_active = false where id = $1 returning id',
      [id],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Admin not found' })

    logAudit({
      entityType: 'admin_user',
      entityId: id,
      action: 'deactivate',
      changes: { isActive: { old: true, new: false } },
      actor: req.adminId,
      reason,
    })

    res.json({ id, isActive: false })
  } catch (err) {
    next(err)
  }
})

export default router
