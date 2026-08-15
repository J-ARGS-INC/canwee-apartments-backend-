import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../middleware/adminAuth.js'
import { adminLimiter } from '../middleware/rateLimiters.js'
import { idempotent } from '../middleware/idempotency.js'
import { maxLength } from '../lib/validate.js'
import { logAudit } from '../lib/auditLog.js'

const router = Router()

router.use(requireAdmin)
router.use(adminLimiter)

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
      `select id, booking_id, amount, payment_method, payment_date, received_by, notes, created_at
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
router.post('/bookings/:id/payments', idempotent(), async (req, res, next) => {
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
      `insert into payments (booking_id, amount, payment_method, payment_date, received_by, notes)
       values ($1, $2, $3, coalesce($4, current_date), $5, $6)
       returning id, booking_id, amount, payment_method, payment_date, received_by, notes, created_at`,
      [id, amountNum, paymentMethod || null, paymentDate || null, req.adminId, notes || null],
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
      changes: { amount: amountNum, paymentMethod: paymentMethod || null, newAmountPaid, paymentStatus },
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

export default router
