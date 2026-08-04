import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../middleware/adminAuth.js'

const router = Router()

const TRANSITIONS = {
  confirm: { from: ['pending'], to: 'confirmed' },
  'check-in': { from: ['confirmed', 'pending'], to: 'checked_in' },
  'check-out': { from: ['checked_in'], to: 'checked_out' },
  cancel: { from: ['pending', 'confirmed'], to: 'cancelled' },
}

router.use(requireAdmin)

router.get('/verify', (req, res) => {
  res.json({ ok: true })
})

router.get('/bookings', async (req, res, next) => {
  try {
    const { status } = req.query
    const params = []
    let where = ''
    if (status) {
      params.push(status)
      where = 'where b.status = $1'
    }

    const { rows } = await pool.query(
      `select b.id, b.listing_id, b.full_name, b.email, b.phone, b.check_in, b.check_out,
              b.guests, b.notes, b.status, b.actual_check_in_at, b.actual_check_out_at,
              b.created_at, b.updated_at, l.title as listing_title, l.city as listing_city
       from bookings b
       join listings l on l.id = b.listing_id
       ${where}
       order by b.check_in desc`,
      params,
    )

    res.json(rows)
  } catch (err) {
    next(err)
  }
})

router.patch('/bookings/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const { action } = req.body ?? {}

    const transition = TRANSITIONS[action]
    if (!transition) {
      return res.status(400).json({ error: `Unknown action "${action}".` })
    }

    const { rows } = await pool.query('select status from bookings where id = $1', [id])
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Booking not found' })
    }

    const currentStatus = rows[0].status
    if (!transition.from.includes(currentStatus)) {
      return res.status(409).json({
        error: `Cannot ${action.replace('-', ' ')} a booking that is currently "${currentStatus}".`,
      })
    }

    const timestampColumn =
      transition.to === 'checked_in'
        ? 'actual_check_in_at'
        : transition.to === 'checked_out'
          ? 'actual_check_out_at'
          : null

    const { rows: updated } = await pool.query(
      `update bookings
       set status = $1, updated_at = now()${timestampColumn ? `, ${timestampColumn} = now()` : ''}
       where id = $2
       returning id, status, actual_check_in_at, actual_check_out_at, updated_at`,
      [transition.to, id],
    )

    res.json(updated[0])
  } catch (err) {
    next(err)
  }
})

export default router
