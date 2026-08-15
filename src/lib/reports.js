import { pool } from '../db.js'
import { isValidDate } from './validate.js'

// Shared by GET /admin/reports/summary (JSON, used by SummaryTab), the PDF
// export, and the daily/weekly/monthly email digests — one query set, three
// consumers, instead of three copies of this SQL drifting apart over time.
export async function buildSummaryReport({ startDate, endDate } = {}) {
  // The report is scoped by stay date (check_in), not booking-creation
  // date, so "revenue for March" means stays checking in during March —
  // matching how the calendar/availability views already think about
  // dates. Both bounds are optional and independent.
  const bookingParams = []
  const bookingConditions = []
  if (isValidDate(startDate)) {
    bookingParams.push(startDate)
    bookingConditions.push(`b.check_in >= $${bookingParams.length}`)
  }
  if (isValidDate(endDate)) {
    bookingParams.push(endDate)
    bookingConditions.push(`b.check_in <= $${bookingParams.length}`)
  }
  const bookingWhere = bookingConditions.length ? `where ${bookingConditions.join(' and ')}` : ''
  const bookingWhereAnd = bookingConditions.length ? `and ${bookingConditions.join(' and ')}` : ''

  const expenseParams = []
  const expenseConditions = ['deleted_at is null']
  if (isValidDate(startDate)) {
    expenseParams.push(startDate)
    expenseConditions.push(`expense_date >= $${expenseParams.length}`)
  }
  if (isValidDate(endDate)) {
    expenseParams.push(endDate)
    expenseConditions.push(`expense_date <= $${expenseParams.length}`)
  }

  const { rows: totals } = await pool.query(
    `select
      coalesce(sum(b.total_amount), 0) as total_revenue,
      coalesce(sum(b.amount_paid), 0) as total_collected,
      coalesce(sum(b.balance), 0) as total_outstanding,
      count(*) filter (where b.status != 'cancelled') as active_bookings,
      count(*) as total_bookings
    from bookings b
    ${bookingWhere}`,
    bookingParams,
  )

  const { rows: byLocation } = await pool.query(
    `select l.city as location,
           coalesce(sum(b.total_amount), 0) as revenue,
           coalesce(sum(b.amount_paid), 0) as collected,
           count(*) as bookings
    from bookings b
    join listings l on l.id = b.listing_id
    where b.status != 'cancelled' ${bookingWhereAnd}
    group by l.city
    order by l.city`,
    bookingParams,
  )

  const { rows: byPaymentMethod } = await pool.query(
    `select coalesce(b.payment_method, 'Unspecified') as payment_method,
           coalesce(sum(b.amount_paid), 0) as collected,
           count(*) as bookings
    from bookings b
    where b.amount_paid > 0 ${bookingWhereAnd}
    group by payment_method
    order by collected desc`,
    bookingParams,
  )

  const { rows: bySource } = await pool.query(
    `select coalesce(b.source_channel, 'Unspecified') as source_channel, count(*) as bookings
    from bookings b
    where b.status != 'cancelled' ${bookingWhereAnd}
    group by source_channel
    order by bookings desc`,
    bookingParams,
  )

  const { rows: byStatus } = await pool.query(
    `select b.status, count(*) as bookings
    from bookings b
    ${bookingWhere}
    group by b.status
    order by bookings desc`,
    bookingParams,
  )

  const { rows: byPaymentStatus } = await pool.query(
    `select b.payment_status, count(*) as bookings
    from bookings b
    where b.status != 'cancelled' ${bookingWhereAnd}
    group by b.payment_status
    order by bookings desc`,
    bookingParams,
  )

  const { rows: topListings } = await pool.query(
    `select l.title, l.unit_code, l.city,
           coalesce(sum(b.amount_paid), 0) as collected,
           count(*) as bookings
    from bookings b
    join listings l on l.id = b.listing_id
    where b.status != 'cancelled' ${bookingWhereAnd}
    group by l.id, l.title, l.unit_code, l.city
    order by collected desc
    limit 5`,
    bookingParams,
  )

  const { rows: bottomListings } = await pool.query(
    `select l.title, l.unit_code, l.city,
           coalesce(sum(b.amount_paid), 0) as collected,
           count(*) as bookings
    from bookings b
    join listings l on l.id = b.listing_id
    where b.status != 'cancelled' ${bookingWhereAnd}
    group by l.id, l.title, l.unit_code, l.city
    order by collected asc
    limit 5`,
    bookingParams,
  )

  const { rows: dailyRevenue } = await pool.query(
    `select b.check_in::text as date, coalesce(sum(b.amount_paid), 0) as collected
    from bookings b
    where b.status != 'cancelled' ${bookingWhereAnd}
    group by b.check_in
    order by b.check_in`,
    bookingParams,
  )

  const { rows: expenseTotal } = await pool.query(
    `select coalesce(sum(amount), 0) as total_expenses from expenses where ${expenseConditions.join(' and ')}`,
    expenseParams,
  )

  const { rows: expenseByCategory } = await pool.query(
    `select category, coalesce(sum(amount), 0) as amount
    from expenses where ${expenseConditions.join(' and ')}
    group by category
    order by amount desc`,
    expenseParams,
  )

  // Live operational counts, deliberately NOT scoped to the report's date
  // range (unlike everything above) — "who is checked in right now" and
  // "what needs attention in the next 48 hours" are always relative to the
  // current moment, regardless of what historical period is being reviewed.
  const { rows: operational } = await pool.query(`
    select
      count(*) filter (where status = 'checked_in') as checked_in_now,
      count(*) filter (where status in ('pending', 'confirmed') and check_in between current_date and current_date + interval '2 days') as upcoming_check_ins_48h,
      count(*) filter (where status = 'checked_in' and check_out between current_date and current_date + interval '2 days') as upcoming_check_outs_48h,
      count(*) filter (where status in ('pending', 'confirmed') and payment_status in ('unpaid', 'part_payment')) as unpaid_reserved_bookings
    from bookings
  `)

  const activeBookings = Number(totals[0].active_bookings)
  const totalCollected = Number(totals[0].total_collected)
  const totalExpenses = Number(expenseTotal[0].total_expenses)

  return {
    startDate: startDate || null,
    endDate: endDate || null,
    totalRevenue: Number(totals[0].total_revenue),
    totalCollected,
    totalOutstanding: Number(totals[0].total_outstanding),
    activeBookings,
    totalBookings: Number(totals[0].total_bookings),
    averageBookingValue: activeBookings > 0 ? totalCollected / activeBookings : 0,
    totalExpenses,
    netIncome: totalCollected - totalExpenses,
    checkedInNow: Number(operational[0].checked_in_now),
    upcomingCheckIns48h: Number(operational[0].upcoming_check_ins_48h),
    upcomingCheckOuts48h: Number(operational[0].upcoming_check_outs_48h),
    unpaidReservedBookings: Number(operational[0].unpaid_reserved_bookings),
    expenseByCategory: expenseByCategory.map((r) => ({
      category: r.category,
      amount: Number(r.amount),
      percent: totalExpenses > 0 ? (Number(r.amount) / totalExpenses) * 100 : 0,
    })),
    byLocation: byLocation.map((r) => ({
      location: r.location,
      revenue: Number(r.revenue),
      collected: Number(r.collected),
      bookings: Number(r.bookings),
    })),
    byPaymentMethod: byPaymentMethod.map((r) => ({
      paymentMethod: r.payment_method,
      collected: Number(r.collected),
      bookings: Number(r.bookings),
    })),
    bySource: bySource.map((r) => ({ sourceChannel: r.source_channel, bookings: Number(r.bookings) })),
    byStatus: byStatus.map((r) => ({ status: r.status, bookings: Number(r.bookings) })),
    byPaymentStatus: byPaymentStatus.map((r) => ({ paymentStatus: r.payment_status, bookings: Number(r.bookings) })),
    topListings: topListings.map((r) => ({
      title: r.title,
      unitCode: r.unit_code,
      city: r.city,
      collected: Number(r.collected),
      bookings: Number(r.bookings),
    })),
    bottomListings: bottomListings.map((r) => ({
      title: r.title,
      unitCode: r.unit_code,
      city: r.city,
      collected: Number(r.collected),
      bookings: Number(r.bookings),
    })),
    dailyRevenue: dailyRevenue.map((r) => ({ date: r.date, collected: Number(r.collected) })),
  }
}
