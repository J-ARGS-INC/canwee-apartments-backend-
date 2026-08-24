import { Router } from 'express'
import multer from 'multer'
import { pool } from '../db.js'
import { requireAdmin, requireSuperAdmin } from '../middleware/adminAuth.js'
import { adminLimiter } from '../middleware/rateLimiters.js'
import { idempotent } from '../middleware/idempotency.js'
import { maxLength } from '../lib/validate.js'
import { logAudit } from '../lib/auditLog.js'

const router = Router()

router.use(requireAdmin)
router.use(adminLimiter)

// Any admin can attach a receipt when logging a payment (fraud-prevention
// evidence, not a gate on the transaction itself) — only GET .../receipt
// below is super-admin-only, since inspecting whether it's a genuine
// receipt is the sensitive action, not attaching one. Memory storage since
// the destination is Postgres bytea, never Render's filesystem.
const RECEIPT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(req, file, cb) {
    if (!RECEIPT_MIME_TYPES.has(file.mimetype)) return cb(new Error('UNSUPPORTED_RECEIPT_TYPE'))
    cb(null, true)
  },
})

// multer's own errors (oversize file, rejected mimetype) arrive as
// exceptions thrown from inside its middleware, not as a deliberately-set
// 4xx `.status` — left alone they'd fall through to app.js's generic error
// handler and surface as an opaque "Internal server error". This translates
// them into the same clean 400 + fields shape every other validation
// failure in this file already returns.
function uploadReceipt(req, res, next) {
  upload.single('receipt')(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Receipt file is too large (max 8MB).' })
    }
    if (err && err.message === 'UNSUPPORTED_RECEIPT_TYPE') {
      return res.status(400).json({ error: 'Receipt must be a JPEG, PNG, WEBP image, or a PDF.' })
    }
    if (err) return next(err)
    next()
  })
}

// Same status math as validatePaymentConsistency in admin.js, but derived
// automatically here rather than admin-chosen — logging a real payment is
// exactly the "final required information" event the payment_status should
// react to on its own.
function derivePaymentStatus(paid, total) {
  if (paid <= 0) return 'unpaid'
  if (total == null) return 'part_payment'
  if (paid > total + 0.01) return 'overpaid'
  if (paid >= total - 0.01) return 'paid'
  return 'part_payment'
}

router.get('/bookings/:id/payments', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `select id, booking_id, amount, payment_method, payment_date, received_by, notes, created_at,
              (receipt_data is not null) as has_receipt
       from payments where booking_id = $1 order by payment_date desc, created_at desc`,
      [req.params.id],
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// idempotent() first: a retried/double-fired submit (double-tap, a flaky
// mobile network retrying the same request) replays the original response
// instead of logging a second real payment — this matters more here than
// almost anywhere else in the app, since two payments aren't naturally
// deduplicated by anything else the way a duplicate status change is.
router.post('/bookings/:id/payments', idempotent(), uploadReceipt, async (req, res, next) => {
  const { id } = req.params
  const { amount, paymentMethod, paymentDate, notes } = req.body ?? {}

  const errors = {}
  const amountNum = Number(amount)
  if (!amount || !Number.isFinite(amountNum) || amountNum <= 0) errors.amount = 'Enter a valid payment amount.'
  maxLength(paymentMethod, 'paymentMethod', 50, errors)
  maxLength(notes, 'notes', 2000, errors)
  if (Object.keys(errors).length > 0) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors })

  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Row lock so two payments logged for the same booking at nearly the
    // same instant can't both read the same starting amount_paid and both
    // compute a total that only reflects one of them.
    const { rows: locked } = await client.query(
      'select amount_paid, total_amount, status from bookings where id = $1 for update',
      [id],
    )
    if (locked.length === 0) {
      await client.query('ROLLBACK')
      return res.status(404).json({ error: 'Booking not found.' })
    }

    const { rows: inserted } = await client.query(
      `insert into payments (booking_id, amount, payment_method, payment_date, received_by, notes, receipt_content_type, receipt_data)
       values ($1, $2, $3, coalesce($4, current_date), $5, $6, $7, $8)
       returning id, booking_id, amount, payment_method, payment_date, received_by, notes, created_at,
                 (receipt_data is not null) as has_receipt`,
      [
        id, amountNum, paymentMethod || null, paymentDate || null, req.adminId, notes || null,
        req.file?.mimetype || null, req.file?.buffer || null,
      ],
    )

    const newAmountPaid = Number(locked[0].amount_paid) + amountNum
    const total = locked[0].total_amount != null ? Number(locked[0].total_amount) : null
    const paymentStatus = derivePaymentStatus(newAmountPaid, total)

    const { rows: updated } = await client.query(
      `update bookings
       set amount_paid = $1, payment_status = $2, payment_method = coalesce($3, payment_method),
           payment_date = coalesce($4, payment_date), updated_at = now()
       where id = $5
       returning id, amount_paid, balance, payment_status`,
      [newAmountPaid, paymentStatus, paymentMethod || null, paymentDate || null, id],
    )

    await client.query('COMMIT')

    logAudit({
      entityType: 'booking',
      entityId: id,
      action: 'payment_added',
      changes: { amount: amountNum, paymentMethod: paymentMethod || null, newAmountPaid, paymentStatus, hasReceipt: Boolean(req.file) },
      actor: req.adminId,
    })

    res.status(201).json({ payment: inserted[0], booking: updated[0] })
  } catch (err) {
    await client.query('ROLLBACK')
    next(err)
  } finally {
    client.release()
  }
})

// Super-admin-only: any admin can attach a receipt, but only a super admin
// can open and inspect one afterward — a compromised or dishonest regular
// admin account shouldn't be able to both fabricate a payment and "confirm"
// its own fake evidence. Every inspection is audit-logged.
router.get('/payments/:id/receipt', requireSuperAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'select receipt_content_type, receipt_data from payments where id = $1',
      [req.params.id],
    )
    if (rows.length === 0 || rows[0].receipt_data == null) {
      return res.status(404).json({ error: 'No receipt found for this payment.' })
    }

    logAudit({
      entityType: 'payment',
      entityId: req.params.id,
      action: 'receipt_viewed',
      changes: null,
      actor: req.adminId,
    })

    res.setHeader('Content-Type', rows[0].receipt_content_type)
    // Unlike images.js's public, cacheable listing photos, this is sensitive
    // financial evidence behind auth — private/no-store keeps it out of any
    // shared/corporate proxy cache.
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', 'inline')
    res.send(rows[0].receipt_data)
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'No receipt found for this payment.' })
    next(err)
  }
})

export default router
