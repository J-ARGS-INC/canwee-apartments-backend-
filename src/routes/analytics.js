import { Router } from 'express'
import { pool } from '../db.js'

// Deliberately NOT gated by requireAdmin — the owner asked for a
// no-login analytics view, reachable only by knowing its obscure frontend
// URL. Still covered by the global apiLimiter in app.js for basic abuse
// protection, but there is no authentication here at all: anyone with
// this route's URL can read full revenue/booking/expense data.
const router = Router()

function periodTotals(rows, prefix) {
  const r = rows[0]
  return {
    today: Number(r[`${prefix}_today`]),
    thisWeek: Number(r[`${prefix}_week`]),
    thisMonth: Number(r[`${prefix}_month`]),
    thisYear: Number(r[`${prefix}_year`]),
    allTime: Number(r[`${prefix}_all`]),
  }
}

router.get('/summary', async (req, res, next) => {
  try {
    const { rows: bookingRows } = await pool.query(`
      select
        count(*) filter (where booking_date = current_date) as bookings_today,
        count(*) filter (where booking_date >= date_trunc('week', current_date)) as bookings_week,
        count(*) filter (where booking_date >= date_trunc('month', current_date)) as bookings_month,
        count(*) filter (where booking_date >= date_trunc('year', current_date)) as bookings_year,
        count(*) as bookings_all,
        count(distinct phone) filter (where booking_date = current_date) as guests_today,
        count(distinct phone) filter (where booking_date >= date_trunc('week', current_date)) as guests_week,
        count(distinct phone) filter (where booking_date >= date_trunc('month', current_date)) as guests_month,
        count(distinct phone) filter (where booking_date >= date_trunc('year', current_date)) as guests_year,
        count(distinct phone) as guests_all,
        coalesce(sum(total_amount) filter (where booking_date = current_date), 0) as booked_today,
        coalesce(sum(total_amount) filter (where booking_date >= date_trunc('week', current_date)), 0) as booked_week,
        coalesce(sum(total_amount) filter (where booking_date >= date_trunc('month', current_date)), 0) as booked_month,
        coalesce(sum(total_amount) filter (where booking_date >= date_trunc('year', current_date)), 0) as booked_year,
        coalesce(sum(total_amount), 0) as booked_all,
        coalesce(sum(amount_paid) filter (where booking_date = current_date), 0) as collected_today,
        coalesce(sum(amount_paid) filter (where booking_date >= date_trunc('week', current_date)), 0) as collected_week,
        coalesce(sum(amount_paid) filter (where booking_date >= date_trunc('month', current_date)), 0) as collected_month,
        coalesce(sum(amount_paid) filter (where booking_date >= date_trunc('year', current_date)), 0) as collected_year,
        coalesce(sum(amount_paid), 0) as collected_all
      from bookings
      where status != 'cancelled'
    `)

    const { rows: expenseRows } = await pool.query(`
      select
        coalesce(sum(amount) filter (where expense_date = current_date), 0) as expenses_today,
        coalesce(sum(amount) filter (where expense_date >= date_trunc('week', current_date)), 0) as expenses_week,
        coalesce(sum(amount) filter (where expense_date >= date_trunc('month', current_date)), 0) as expenses_month,
        coalesce(sum(amount) filter (where expense_date >= date_trunc('year', current_date)), 0) as expenses_year,
        coalesce(sum(amount), 0) as expenses_all
      from expenses
      where deleted_at is null
    `)

    const { rows: roomRows } = await pool.query(`
      select l.id, l.title, l.city, l.unit_code,
        exists (
          select 1 from bookings b
          where b.listing_id = l.id and b.status not in ('cancelled', 'no_show')
            and b.check_in <= current_date and b.check_out > current_date
        ) as occupied
      from listings l
      order by l.city, l.title
    `)

    const { rows: trendRows } = await pool.query(`
      select gs::date as date,
        coalesce(count(b.id), 0) as bookings,
        coalesce(sum(b.total_amount), 0) as revenue
      from generate_series(current_date - interval '29 days', current_date, interval '1 day') gs
      left join bookings b on b.booking_date = gs::date and b.status != 'cancelled'
      group by gs
      order by gs
    `)

    const bookings = periodTotals(bookingRows, 'bookings')
    const uniqueGuests = periodTotals(bookingRows, 'guests')
    const bookedRevenue = periodTotals(bookingRows, 'booked')
    const collectedRevenue = periodTotals(bookingRows, 'collected')
    const expenses = periodTotals(expenseRows, 'expenses')

    const netIncome = {
      today: collectedRevenue.today - expenses.today,
      thisWeek: collectedRevenue.thisWeek - expenses.thisWeek,
      thisMonth: collectedRevenue.thisMonth - expenses.thisMonth,
      thisYear: collectedRevenue.thisYear - expenses.thisYear,
      allTime: collectedRevenue.allTime - expenses.allTime,
    }

    res.json({
      bookings,
      uniqueGuests,
      bookedRevenue,
      collectedRevenue,
      expenses,
      netIncome,
      rooms: {
        total: roomRows.length,
        availableNow: roomRows.filter((r) => !r.occupied).length,
        occupiedNow: roomRows.filter((r) => r.occupied).length,
        list: roomRows.map((r) => ({
          listingId: r.id,
          title: r.title,
          city: r.city,
          unitCode: r.unit_code,
          status: r.occupied ? 'occupied' : 'available',
        })),
      },
      trend: trendRows.map((r) => ({ date: r.date, bookings: Number(r.bookings), revenue: Number(r.revenue) })),
    })
  } catch (err) {
    next(err)
  }
})

export default router
