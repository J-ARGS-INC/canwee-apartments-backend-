import { Router } from 'express'
import { pool } from '../db.js'
import { isValidDate } from '../lib/validate.js'
import { locationCondition, locationLabelSql } from '../lib/location.js'

// Deliberately NOT gated by requireAdmin — the owner asked for a
// no-login analytics view, reachable only by knowing its obscure frontend
// URL. Still covered by the global apiLimiter in app.js for basic abuse
// protection, but there is no authentication here at all: anyone with
// this route's URL can read full revenue/booking/expense data, now
// filterable by their own choice of date range and location the same way
// the super admin's Payment Summary tab is.
const router = Router()

router.get('/summary', async (req, res, next) => {
  try {
    const { startDate, endDate, location } = req.query

    const bookingParams = []
    const bookingConditions = ["b.status != 'cancelled'"]
    if (isValidDate(startDate)) {
      bookingParams.push(startDate)
      bookingConditions.push(`b.booking_date >= $${bookingParams.length}`)
    }
    if (isValidDate(endDate)) {
      bookingParams.push(endDate)
      bookingConditions.push(`b.booking_date <= $${bookingParams.length}`)
    }
    const bookingLocationCond = locationCondition(location, bookingParams, 'l')
    if (bookingLocationCond) bookingConditions.push(bookingLocationCond)
    const bookingWhere = `where ${bookingConditions.join(' and ')}`

    const expenseParams = []
    const expenseConditions = ['e.deleted_at is null']
    if (isValidDate(startDate)) {
      expenseParams.push(startDate)
      expenseConditions.push(`e.expense_date >= $${expenseParams.length}`)
    }
    if (isValidDate(endDate)) {
      expenseParams.push(endDate)
      expenseConditions.push(`e.expense_date <= $${expenseParams.length}`)
    }
    const expenseLocationCond = locationCondition(location, expenseParams, 'l')
    if (expenseLocationCond) expenseConditions.push(expenseLocationCond)
    const expenseWhere = `where ${expenseConditions.join(' and ')}`

    const { rows: totals } = await pool.query(
      `select
        count(*) as bookings,
        count(distinct b.phone) as unique_guests,
        coalesce(sum(b.total_amount), 0) as booked_revenue,
        coalesce(sum(b.amount_paid), 0) as collected_revenue
      from bookings b
      join listings l on l.id = b.listing_id
      ${bookingWhere}`,
      bookingParams,
    )

    const { rows: expenseRows } = await pool.query(
      `select coalesce(sum(e.amount), 0) as expenses
      from expenses e
      left join listings l on l.id = e.listing_id
      ${expenseWhere}`,
      expenseParams,
    )

    // "Which location is making more money" — the owner's actual ask.
    // Same shape as the super admin's byLocation breakdown, sorted by
    // collected revenue so the top earner is always first.
    const { rows: byLocation } = await pool.query(
      `select ${locationLabelSql('l')} as location,
        count(*) as bookings,
        coalesce(sum(b.total_amount), 0) as revenue,
        coalesce(sum(b.amount_paid), 0) as collected
      from bookings b
      join listings l on l.id = b.listing_id
      ${bookingWhere}
      group by location
      order by collected desc`,
      bookingParams,
    )

    // Bucketed by whatever range/location is actually selected, same as the
    // super admin's dailyRevenue chart — no artificial "always last 30
    // days" padding, so this stays honest about "All time" showing the
    // full history.
    const { rows: trendRows } = await pool.query(
      `select b.booking_date::text as date,
        count(*) as bookings,
        coalesce(sum(b.total_amount), 0) as revenue
      from bookings b
      join listings l on l.id = b.listing_id
      ${bookingWhere}
      group by b.booking_date
      order by b.booking_date`,
      bookingParams,
    )

    // "Rooms right now" is a live operational snapshot, not scoped to the
    // report period — same reasoning as the super admin's own "right now"
    // stats — but it does respect the location filter, so picking a
    // location shows only that location's rooms.
    const roomParams = []
    const roomLocationCond = locationCondition(location, roomParams, 'l')
    const roomWhere = roomLocationCond ? `where ${roomLocationCond}` : ''

    const { rows: roomRows } = await pool.query(
      `select l.id, l.title, l.city, l.unit_code,
        exists (
          select 1 from bookings b
          where b.listing_id = l.id and b.status not in ('cancelled', 'no_show')
            and b.check_in <= current_date and b.check_out > current_date
        ) as occupied
      from listings l
      ${roomWhere}
      order by l.city, l.title`,
      roomParams,
    )

    const bookedRevenue = Number(totals[0].booked_revenue)
    const collectedRevenue = Number(totals[0].collected_revenue)
    const expensesTotal = Number(expenseRows[0].expenses)

    res.json({
      startDate: startDate || null,
      endDate: endDate || null,
      location: location || null,
      bookings: Number(totals[0].bookings),
      uniqueGuests: Number(totals[0].unique_guests),
      bookedRevenue,
      collectedRevenue,
      expenses: expensesTotal,
      netIncome: collectedRevenue - expensesTotal,
      byLocation: byLocation.map((r) => ({
        location: r.location,
        bookings: Number(r.bookings),
        revenue: Number(r.revenue),
        collected: Number(r.collected),
      })),
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
