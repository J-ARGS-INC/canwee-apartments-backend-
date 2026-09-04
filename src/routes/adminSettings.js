import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin, requireSuperAdmin } from '../middleware/adminAuth.js'
import { adminLimiter } from '../middleware/rateLimiters.js'
import { logAudit } from '../lib/auditLog.js'
import { isValidEmail } from '../lib/validate.js'
import { SETTING_DEFAULTS, getAllSettings } from '../lib/settings.js'

const router = Router()

router.use(requireAdmin)
router.use(adminLimiter)

// Reads are open to any admin — staff need expense_categories/
// payment_methods to populate their own forms. Only super admins can write
// (enforced per-route below), matching "only Super Admin can access
// Settings" from the access-control spec while staff still get to use the
// options a super admin configured.
router.get('/', async (req, res, next) => {
  try {
    res.json(await getAllSettings())
  } catch (err) {
    next(err)
  }
})

function validateValue(key, value) {
  if (key === 'notify_emails') {
    if (!Array.isArray(value) || value.some((v) => typeof v !== 'string' || !isValidEmail(v))) {
      return 'notify_emails must be a list of valid email addresses.'
    }
  } else if (key === 'expense_categories' || key === 'payment_methods') {
    if (!Array.isArray(value) || value.length === 0 || value.some((v) => typeof v !== 'string' || !v.trim())) {
      return `${key} must be a non-empty list of labels.`
    }
  } else if (key === 'default_discount_per_night') {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
      return 'default_discount_per_night must be a non-negative number.'
    }
  }
  return null
}

router.put('/:key', requireSuperAdmin, async (req, res, next) => {
  try {
    const { key } = req.params
    if (!(key in SETTING_DEFAULTS)) {
      return res.status(400).json({ error: `Unknown setting "${key}".` })
    }

    const { value } = req.body ?? {}
    const validationError = validateValue(key, value)
    if (validationError) return res.status(400).json({ error: validationError })

    const { rows: before } = await pool.query('select value from settings where key = $1', [key])

    await pool.query(
      `insert into settings (key, value, updated_by, updated_at) values ($1, $2, $3, now())
       on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`,
      [key, JSON.stringify(value), req.adminId],
    )

    logAudit({
      entityType: 'setting',
      entityId: key,
      action: 'update',
      changes: { old: before[0]?.value ?? SETTING_DEFAULTS[key], new: value },
      actor: req.adminId,
    })

    res.json({ key, value })
  } catch (err) {
    next(err)
  }
})

export default router
