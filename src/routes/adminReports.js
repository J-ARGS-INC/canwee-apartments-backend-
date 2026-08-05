import { Router } from 'express'
import ExcelJS from 'exceljs'
import { pool } from '../db.js'
import { requireAdmin } from '../middleware/adminAuth.js'
import { adminLimiter } from '../middleware/rateLimiters.js'

const router = Router()

router.use(requireAdmin)
router.use(adminLimiter)

router.get('/audit-log', async (req, res, next) => {
  try {
    const { entityType, entityId } = req.query
    const conditions = []
    const params = []
    if (entityType && typeof entityType === 'string') {
      params.push(entityType)
      conditions.push(`entity_type = $${params.length}`)
    }
    if (entityId && typeof entityId === 'string') {
      params.push(entityId)
      conditions.push(`entity_id = $${params.length}`)
    }
    const where = conditions.length ? `where ${conditions.join(' and ')}` : ''

    const { rows } = await pool.query(
      `select id, entity_type, entity_id, action, changes, actor, reason, created_at
       from audit_log ${where} order by created_at desc limit 200`,
      params,
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

router.get('/reports/summary', async (req, res, next) => {
  try {
    const { rows: totals } = await pool.query(`
      select
        coalesce(sum(total_amount), 0) as total_revenue,
        coalesce(sum(amount_paid), 0) as total_collected,
        coalesce(sum(balance), 0) as total_outstanding,
        count(*) filter (where status != 'cancelled') as active_bookings
      from bookings
    `)

    const { rows: byLocation } = await pool.query(`
      select l.city as location,
             coalesce(sum(b.total_amount), 0) as revenue,
             coalesce(sum(b.amount_paid), 0) as collected,
             count(*) as bookings
      from bookings b
      join listings l on l.id = b.listing_id
      where b.status != 'cancelled'
      group by l.city
      order by l.city
    `)

    const { rows: byPaymentMethod } = await pool.query(`
      select coalesce(payment_method, 'Unspecified') as payment_method,
             coalesce(sum(amount_paid), 0) as collected,
             count(*) as bookings
      from bookings
      where amount_paid > 0
      group by payment_method
      order by collected desc
    `)

    const { rows: bySource } = await pool.query(`
      select coalesce(source_channel, 'Unspecified') as source_channel, count(*) as bookings
      from bookings
      where status != 'cancelled'
      group by source_channel
      order by bookings desc
    `)

    const { rows: expenseTotal } = await pool.query(
      'select coalesce(sum(amount), 0) as total_expenses from expenses where deleted_at is null',
    )

    res.json({
      totalRevenue: Number(totals[0].total_revenue),
      totalCollected: Number(totals[0].total_collected),
      totalOutstanding: Number(totals[0].total_outstanding),
      activeBookings: Number(totals[0].active_bookings),
      totalExpenses: Number(expenseTotal[0].total_expenses),
      netIncome: Number(totals[0].total_collected) - Number(expenseTotal[0].total_expenses),
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
    })
  } catch (err) {
    next(err)
  }
})

router.get('/availability', async (req, res, next) => {
  try {
    const { rows: listingsRows } = await pool.query(
      `select id, title, city, unit_code from listings order by city, title`,
    )
    const { rows: bookingRows } = await pool.query(`
      select listing_id, check_in, check_out, status, full_name
      from bookings
      where status not in ('cancelled') and check_out >= current_date
      order by check_in
    `)

    const byListing = new Map()
    for (const booking of bookingRows) {
      if (!byListing.has(booking.listing_id)) byListing.set(booking.listing_id, [])
      byListing.get(booking.listing_id).push({
        checkIn: booking.check_in,
        checkOut: booking.check_out,
        status: booking.status,
        guestName: booking.full_name,
      })
    }

    res.json(
      listingsRows.map((listing) => ({
        listingId: listing.id,
        title: listing.title,
        city: listing.city,
        unitCode: listing.unit_code,
        upcomingStays: byListing.get(listing.id) || [],
      })),
    )
  } catch (err) {
    next(err)
  }
})

router.get('/export/workbook.xlsx', async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Canwee Apartments'
    workbook.created = new Date()

    const bookingsSheet = workbook.addWorksheet('Bookings')
    bookingsSheet.columns = [
      { header: 'Booking ID', key: 'booking_code', width: 12 },
      { header: 'Booking Date', key: 'booking_date', width: 14 },
      { header: 'Guest Name', key: 'full_name', width: 22 },
      { header: 'Phone Number', key: 'phone', width: 16 },
      { header: 'Location', key: 'listing_city', width: 12 },
      { header: 'Unit Code', key: 'unit_code', width: 20 },
      { header: 'Unit Type', key: 'unit_type', width: 14 },
      { header: 'Check-In Date', key: 'check_in', width: 14 },
      { header: 'Check-Out Date', key: 'check_out', width: 14 },
      { header: 'Nights', key: 'nights', width: 8 },
      { header: 'Standard Rate/Night', key: 'rate_per_night', width: 18 },
      { header: 'Discount / Adjustment', key: 'discount', width: 18 },
      { header: 'Total Amount', key: 'total_amount', width: 14 },
      { header: 'Amount Paid', key: 'amount_paid', width: 14 },
      { header: 'Balance', key: 'balance', width: 12 },
      { header: 'Payment Status', key: 'payment_status', width: 14 },
      { header: 'Booking Status', key: 'status', width: 14 },
      { header: 'Payment Method', key: 'payment_method', width: 14 },
      { header: 'Payment Date', key: 'payment_date', width: 14 },
      { header: 'Source / Channel', key: 'source_channel', width: 14 },
      { header: 'Received By', key: 'received_by', width: 14 },
      { header: 'Notes', key: 'notes', width: 30 },
    ]
    bookingsSheet.getRow(1).font = { bold: true }

    const { rows: bookings } = await pool.query(`
      select b.booking_code, b.booking_date, b.full_name, b.phone, l.city as listing_city,
             l.unit_code, l.bedrooms, b.check_in, b.check_out, b.rate_per_night, b.discount,
             b.total_amount, b.amount_paid, b.balance, b.payment_status, b.status,
             b.payment_method, b.payment_date, b.source_channel, b.received_by, b.notes
      from bookings b
      join listings l on l.id = b.listing_id
      order by b.check_in desc
    `)

    for (const b of bookings) {
      const nights = Math.round((new Date(b.check_out) - new Date(b.check_in)) / (1000 * 60 * 60 * 24))
      bookingsSheet.addRow({
        ...b,
        unit_type: b.bedrooms === 0 ? 'Studio' : `${b.bedrooms} Bedroom${b.bedrooms > 1 ? 's' : ''}`,
        nights,
      })
    }

    const expensesSheet = workbook.addWorksheet('Expenses')
    expensesSheet.columns = [
      { header: 'Date', key: 'expense_date', width: 14 },
      { header: 'Category', key: 'category', width: 18 },
      { header: 'Description', key: 'description', width: 30 },
      { header: 'Amount', key: 'amount', width: 14 },
      { header: 'Property', key: 'listing_title', width: 22 },
      { header: 'Paid To', key: 'paid_to', width: 18 },
      { header: 'Logged By', key: 'logged_by', width: 14 },
      { header: 'Notes', key: 'notes', width: 30 },
    ]
    expensesSheet.getRow(1).font = { bold: true }

    const { rows: expenses } = await pool.query(`
      select e.expense_date, e.category, e.description, e.amount, l.title as listing_title,
             e.paid_to, e.logged_by, e.notes
      from expenses e
      left join listings l on l.id = e.listing_id
      where e.deleted_at is null
      order by e.expense_date desc
    `)
    for (const e of expenses) expensesSheet.addRow(e)

    const summarySheet = workbook.addWorksheet('Payment Summary')
    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 28 },
      { header: 'Value', key: 'value', width: 18 },
    ]
    summarySheet.getRow(1).font = { bold: true }

    const { rows: totals } = await pool.query(`
      select coalesce(sum(total_amount), 0) as total_revenue,
             coalesce(sum(amount_paid), 0) as total_collected,
             coalesce(sum(balance), 0) as total_outstanding
      from bookings
    `)
    const { rows: expenseTotal } = await pool.query(
      'select coalesce(sum(amount), 0) as total_expenses from expenses where deleted_at is null',
    )
    summarySheet.addRow({ metric: 'Total Revenue', value: Number(totals[0].total_revenue) })
    summarySheet.addRow({ metric: 'Total Collected', value: Number(totals[0].total_collected) })
    summarySheet.addRow({ metric: 'Total Outstanding', value: Number(totals[0].total_outstanding) })
    summarySheet.addRow({ metric: 'Total Expenses', value: Number(expenseTotal[0].total_expenses) })
    summarySheet.addRow({
      metric: 'Net Income',
      value: Number(totals[0].total_collected) - Number(expenseTotal[0].total_expenses),
    })

    const availabilitySheet = workbook.addWorksheet('Availability')
    availabilitySheet.columns = [
      { header: 'Unit', key: 'unit', width: 24 },
      { header: 'City', key: 'city', width: 12 },
      { header: 'Guest', key: 'guest', width: 20 },
      { header: 'Check-In', key: 'check_in', width: 14 },
      { header: 'Check-Out', key: 'check_out', width: 14 },
      { header: 'Status', key: 'status', width: 14 },
    ]
    availabilitySheet.getRow(1).font = { bold: true }

    const { rows: upcoming } = await pool.query(`
      select l.title as unit, l.city, b.full_name as guest, b.check_in, b.check_out, b.status
      from bookings b
      join listings l on l.id = b.listing_id
      where b.status != 'cancelled' and b.check_out >= current_date
      order by l.city, l.title, b.check_in
    `)
    for (const row of upcoming) availabilitySheet.addRow(row)

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename="canwee-export-${new Date().toISOString().slice(0, 10)}.xlsx"`)
    await workbook.xlsx.write(res)
    res.end()
  } catch (err) {
    next(err)
  }
})

export default router
