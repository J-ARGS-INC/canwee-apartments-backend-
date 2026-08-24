import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../middleware/adminAuth.js'
import { adminLimiter } from '../middleware/rateLimiters.js'
import { maxLength, requireString } from '../lib/validate.js'

const router = Router()

router.use(requireAdmin)
router.use(adminLimiter)

// No requireSuperAdmin: plain booking creation (POST /admin/bookings) isn't
// super-admin-gated either, and requiring escalation just to record a
// brand-new agent mid-booking would break that same real-time workflow.
router.get('/agents', async (req, res, next) => {
  try {
    const { rows } = await pool.query('select id, name, phone from agents order by name')
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

router.post('/agents', async (req, res, next) => {
  try {
    const { name, phone } = req.body ?? {}

    const errors = {}
    requireString(name, 'name', errors)
    maxLength(name, 'name', 200, errors)
    maxLength(phone, 'phone', 30, errors)
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: errors })
    }

    const { rows } = await pool.query(
      'insert into agents (name, phone) values ($1, $2) returning id, name, phone',
      [name.trim(), phone || null],
    )
    res.status(201).json(rows[0])
  } catch (err) {
    // The partial unique index on phone — same duplicate this table exists
    // to prevent from creeping back in at data-entry time.
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An agent with this phone number already exists — pick them from the list instead.' })
    }
    next(err)
  }
})

export default router
