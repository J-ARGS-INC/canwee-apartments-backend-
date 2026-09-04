import { Router } from 'express'
import multer from 'multer'
import { pool } from '../db.js'
import { requireAdmin, requireSuperAdmin } from '../middleware/adminAuth.js'
import { adminLimiter } from '../middleware/rateLimiters.js'
import { idempotent } from '../middleware/idempotency.js'
import { isValidDate, maxLength } from '../lib/validate.js'
import { logAudit } from '../lib/auditLog.js'
import { derivePaymentStatus } from '../lib/paymentStatus.js'
import { locationCondition } from '../lib/location.js'

const router = Router()

router.use(requireAdmin)
router.use(adminLimiter)

// Every payment must include at least one receipt file, up to two (the
// second slot is only offered in the UI when the admin marks a payment as
// partial). Any admin can attach receipts; only GET .../receipt/:slot below
// is super-admin-only, since inspecting whether it's a genuine receipt is
// the sensitive action, not attaching one — there's no accept/reject step,
// a logged payment counts as revenue immediately, same as before. Memory
// storage since the destination is Postgres bytea, never Render's
// filesystem.
const RECEIPT_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 2 },
  fileFilter(req, file, cb) {
    if (!RECEIPT_MIME_TYPES.has(file.mimetype)) return cb(new Error('UNSUPPORTED_RECEIPT_TYPE'))
    cb(null, true)
  },
})

// multer's own errors (oversize file, rejected mimetype, more than 2 files)
// arrive as exceptions thrown from inside its middleware, not as a
// deliberately-set 4xx `.status` — left alone they'd fall through to
// app.js's generic error handler and surface as an opaque "Internal server
// error". This translates them into the same clean 400 + fields shape every
// other validation failure in this file already returns.
function uploadReceipts(req, res, next) {
  upload.array('receipts', 2)(req, res, (err) => {
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'Receipt file is too large (max 8MB).' })
    }
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({ error: 'You can attach at most 2 receipt images.' })
    }
    if (err && err.message === 'UNSUPPORTED_RECEIPT_TYPE') {
      return res.status(400).json({ error: 'Receipt must be a JPEG, PNG, WEBP image, or a PDF.' })
    }
    if (err) return next(err)
    next()
  })
}

router.get('/bookings/:id/payments', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `select p.id, p.booking_id, p.amount, p.payment_method, p.payment_date, p.received_by, p.notes, p.created_at,
              (p.receipt_data is not null) as has_receipt,
              (p.receipt_data_2 is not null) as has_receipt_2,
              au.display_name as received_by_name
       from payments p
       left join admin_users au on au.id = p.received_by
       where p.booking_id = $1 order by p.payment_date desc, p.created_at desc`,
      [req.params.id],
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

// Super-admin-only browsing view across every payment (not scoped to one
// booking), filterable by location/apartment/date — the "where do I go
// look for a receipt" counterpart to inspecting one from inside a
// booking's own payment history. Same requireSuperAdmin boundary as the
// receipt-bytes route below: a regular admin can attach a receipt but has
// no path to list, browse, or view any receipt, their own included, once
// it's uploaded.
router.get('/payments', requireSuperAdmin, async (req, res, next) => {
  try {
    const { location, listingId, startDate, endDate } = req.query
    const params = []
    const conditions = []

    if (listingId && typeof listingId === 'string') {
      params.push(listingId)
      conditions.push(`b.listing_id = $${params.length}`)
    }
    const locationCond = locationCondition(location, params, 'l')
    if (locationCond) conditions.push(locationCond)
    if (isValidDate(startDate)) {
      params.push(startDate)
      conditions.push(`p.payment_date >= $${params.length}`)
    }
    if (isValidDate(endDate)) {
      params.push(endDate)
      conditions.push(`p.payment_date <= $${params.length}`)
    }

    const where = conditions.length ? `where ${conditions.join(' and ')}` : ''
    const limitNum = Math.min(200, Math.max(1, Number(req.query.limit) || 25))
    const offsetNum = Math.max(0, Number(req.query.offset) || 0)

    const { rows: countRows } = await pool.query(
      `select count(*) from payments p join bookings b on b.id = p.booking_id join listings l on l.id = b.listing_id ${where}`,
      params,
    )
    const total = Number(countRows[0].count)

    const { rows } = await pool.query(
      `select p.id, p.amount, p.payment_method, p.payment_date, p.notes, p.created_at,
              (p.receipt_data is not null) as has_receipt,
              (p.receipt_data_2 is not null) as has_receipt_2,
              b.id as booking_id, b.booking_code, b.full_name as guest_name,
              l.id as listing_id, l.title as listing_title, l.city as listing_city,
              l.neighborhood as listing_neighborhood, l.unit_code,
              au.display_name as received_by_name
       from payments p
       join bookings b on b.id = p.booking_id
       join listings l on l.id = b.listing_id
       left join admin_users au on au.id = p.received_by
       ${where}
       order by p.payment_date desc, p.created_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limitNum, offsetNum],
    )

    res.json({ payments: rows, total })
  } catch (err) {
    next(err)
  }
})

// idempotent() first: a retried/double-fired submit (double-tap, a flaky
// mobile network retrying the same request) replays the original response
// instead of logging a second real payment — this matters more here than
// almost anywhere else in the app, since two payments aren't naturally
// deduplicated by anything else the way a duplicate status change is.
router.post('/bookings/:id/payments', idempotent(), uploadReceipts, async (req, res, next) => {
  const { id } = req.params
  const { amount, paymentMethod, paymentDate, notes } = req.body ?? {}
  const files = req.files || []

  const errors = {}
  const amountNum = Number(amount)
  if (!amount || !Number.isFinite(amountNum) || amountNum <= 0) errors.amount = 'Enter a valid payment amount.'
  maxLength(paymentMethod, 'paymentMethod', 50, errors)
  maxLength(notes, 'notes', 2000, errors)
  // Receipt evidence is mandatory for every payment, not optional supporting
  // material — no admin can log a payment without attaching proof of it.
  if (files.length === 0) errors.receipt = 'Attach a payment receipt (JPEG, PNG, WEBP, or PDF). This is required.'
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
    // The frontend already hides the "Payment" button for a cancelled
    // booking, but that's UI convenience, not enforcement — without this,
    // a direct API call could still log a payment (and count it as
    // revenue) against a booking nobody expects money on anymore.
    if (locked[0].status === 'cancelled') {
      await client.query('ROLLBACK')
      return res.status(400).json({ error: 'This booking is cancelled. Payments can no longer be logged against it.' })
    }

    const { rows: inserted } = await client.query(
      `insert into payments (
        booking_id, amount, payment_method, payment_date, received_by, notes,
        receipt_content_type, receipt_data, receipt_content_type_2, receipt_data_2
      )
       values ($1, $2, $3, coalesce($4, current_date), $5, $6, $7, $8, $9, $10)
       returning id, booking_id, amount, payment_method, payment_date, received_by, notes, created_at,
                 (receipt_data is not null) as has_receipt, (receipt_data_2 is not null) as has_receipt_2`,
      [
        id, amountNum, paymentMethod || null, paymentDate || null, req.adminId, notes || null,
        files[0]?.mimetype || null, files[0]?.buffer || null,
        files[1]?.mimetype || null, files[1]?.buffer || null,
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
      changes: { amount: amountNum, paymentMethod: paymentMethod || null, newAmountPaid, paymentStatus, receiptCount: files.length },
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
// its own fake evidence. Every inspection is audit-logged. View-only — no
// accept/reject action; the payment already counted as revenue the moment
// it was logged. `slot` addresses which of the up-to-two receipt images to
// stream back.
router.get('/payments/:id/receipt/:slot', requireSuperAdmin, async (req, res, next) => {
  try {
    const slot = req.params.slot === '2' ? 2 : 1
    const { rows } = await pool.query(
      slot === 2
        ? 'select receipt_content_type_2 as content_type, receipt_data_2 as data from payments where id = $1'
        : 'select receipt_content_type as content_type, receipt_data as data from payments where id = $1',
      [req.params.id],
    )
    if (rows.length === 0 || rows[0].data == null) {
      return res.status(404).json({ error: 'No receipt found for this payment.' })
    }

    logAudit({
      entityType: 'payment',
      entityId: req.params.id,
      action: 'receipt_viewed',
      changes: { slot },
      actor: req.adminId,
    })

    res.setHeader('Content-Type', rows[0].content_type)
    // Unlike images.js's public, cacheable listing photos, this is sensitive
    // financial evidence behind auth — private/no-store keeps it out of any
    // shared/corporate proxy cache.
    res.setHeader('Cache-Control', 'private, no-store')
    res.setHeader('Content-Disposition', 'inline')
    res.send(rows[0].data)
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'No receipt found for this payment.' })
    next(err)
  }
})

export default router
