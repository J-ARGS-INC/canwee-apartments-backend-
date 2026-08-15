import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../middleware/adminAuth.js'
import { adminLimiter } from '../middleware/rateLimiters.js'

const router = Router()

router.use(requireAdmin)
router.use(adminLimiter)

// There's no dedicated guests table — a guest's identity is derived
// on-the-fly from their booking history, keyed by phone (the one field
// every booking is guaranteed to have; email is optional for admin-entered
// offline bookings). `distinct on` picks the most recent name/email in case
// they were typed slightly differently across visits.
router.get('/guests', async (req, res, next) => {
  try {
    const { search } = req.query
    const params = []
    let searchClause = ''
    if (search && typeof search === 'string' && search.trim()) {
      params.push(`%${search.trim()}%`)
      searchClause = `where phone ilike $${params.length} or full_name ilike $${params.length} or email ilike $${params.length}`
    }

    const limitNum = Math.min(200, Math.max(1, Number(req.query.limit) || 50))
    const offsetNum = Math.max(0, Number(req.query.offset) || 0)

    const { rows: countRows } = await pool.query(
      `select count(*) from (select distinct phone from bookings) t`,
    )

    const { rows } = await pool.query(
      `select distinct on (b.phone) b.phone, b.full_name, b.email,
              g.bookings_count, g.total_spent, g.last_booking_date, g.cancelled_count
       from bookings b
       join (
         select phone,
                count(*) as bookings_count,
                coalesce(sum(amount_paid), 0) as total_spent,
                max(check_in) as last_booking_date,
                count(*) filter (where status in ('cancelled', 'no_show')) as cancelled_count
         from bookings
         group by phone
       ) g on g.phone = b.phone
       ${searchClause}
       order by b.phone, b.created_at desc
       limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limitNum, offsetNum],
    )

    // Re-sort by most-recent-booking after the dedup (the dedup query above
    // has to order by phone for `distinct on` to work) so the list reads
    // newest-guest-activity-first like every other admin list.
    rows.sort((a, b) => new Date(b.last_booking_date) - new Date(a.last_booking_date))

    res.json({
      guests: rows.map((r) => ({
        phone: r.phone,
        fullName: r.full_name,
        email: r.email,
        bookingsCount: Number(r.bookings_count),
        totalSpent: Number(r.total_spent),
        lastBookingDate: r.last_booking_date,
        cancelledCount: Number(r.cancelled_count),
      })),
      total: Number(countRows[0].count),
    })
  } catch (err) {
    next(err)
  }
})

router.get('/guests/:phone', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `select b.id, b.booking_code, b.full_name, b.email, b.phone, b.check_in, b.check_out,
              b.status, b.payment_status, b.total_amount, b.amount_paid, b.balance, b.notes,
              l.title as listing_title, l.city as listing_city
       from bookings b
       join listings l on l.id = b.listing_id
       where b.phone = $1
       order by b.check_in desc`,
      [req.params.phone],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'No bookings found for this guest.' })

    res.json({
      phone: req.params.phone,
      fullName: rows[0].full_name,
      email: rows.find((r) => r.email)?.email || null,
      bookings: rows,
    })
  } catch (err) {
    next(err)
  }
})

export default router
