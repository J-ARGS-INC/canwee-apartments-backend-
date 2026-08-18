import { Router } from 'express'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { pool } from '../db.js'
import { requireAdmin, requireSuperAdmin } from '../middleware/adminAuth.js'
import { adminLimiter } from '../middleware/rateLimiters.js'
import { buildSummaryReport } from '../lib/reports.js'

const router = Router()

router.use(requireAdmin)
router.use(adminLimiter)

// Financial/audit visibility is super-admin-only per the access-control
// spec — staff get operational routes (availability) but not money or the
// audit trail. /availability deliberately stays on plain requireAdmin
// since staff need it for day-to-day check-in/check-out work.
router.get('/audit-log', requireSuperAdmin, async (req, res, next) => {
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

router.get('/reports/summary', requireSuperAdmin, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query
    res.json(await buildSummaryReport({ startDate, endDate }))
  } catch (err) {
    next(err)
  }
})

function formatMoney(amount) {
  return `NGN ${Math.round(amount).toLocaleString('en-US')}`
}

router.get('/export/summary.pdf', requireSuperAdmin, async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query
    const report = await buildSummaryReport({ startDate, endDate })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="canwee-summary-${new Date().toISOString().slice(0, 10)}.pdf"`)

    const doc = new PDFDocument({ margin: 50, size: 'A4' })
    doc.pipe(res)

    doc.fontSize(18).font('Helvetica-Bold').text('Canwee Apartments — Payment Summary')
    const periodLabel = startDate || endDate ? `${startDate || 'inception'} to ${endDate || 'today'}` : 'All time'
    doc.fontSize(10).font('Helvetica').fillColor('#666').text(`Period: ${periodLabel}  ·  Generated ${new Date().toLocaleString('en-US')}`)
    doc.moveDown(1)

    function statRow(pairs) {
      doc.fontSize(10).fillColor('#000')
      const colWidth = (doc.page.width - 100) / pairs.length
      const y = doc.y
      pairs.forEach(([label, value], i) => {
        doc.font('Helvetica').fillColor('#666').text(label, 50 + i * colWidth, y, { width: colWidth - 10 })
        doc.font('Helvetica-Bold').fillColor('#000').text(value, 50 + i * colWidth, y + 14, { width: colWidth - 10 })
      })
      doc.y = y + 34
    }

    statRow([
      ['Total revenue', formatMoney(report.totalRevenue)],
      ['Collected', formatMoney(report.totalCollected)],
      ['Outstanding', formatMoney(report.totalOutstanding)],
    ])
    statRow([
      ['Expenses', formatMoney(report.totalExpenses)],
      ['Net income', formatMoney(report.netIncome)],
      ['Bookings', `${report.activeBookings} active / ${report.totalBookings} total`],
    ])

    function section(title, rows, columns) {
      doc.moveDown(0.5)
      doc.fontSize(12).font('Helvetica-Bold').fillColor('#000').text(title)
      doc.moveDown(0.2)
      if (rows.length === 0) {
        doc.fontSize(9).font('Helvetica').fillColor('#999').text('No data for this period.')
        return
      }
      doc.fontSize(9).font('Helvetica')
      for (const row of rows) {
        doc.fillColor('#333').text(`${columns.label(row)}  —  ${columns.value(row)}`)
      }
    }

    section('Revenue by location', report.byLocation, { label: (r) => r.location, value: (r) => formatMoney(r.collected) })
    section('Collected by payment method', report.byPaymentMethod, { label: (r) => r.paymentMethod, value: (r) => formatMoney(r.collected) })
    section('Bookings by status', report.byStatus, { label: (r) => r.status.replace('_', ' '), value: (r) => String(r.bookings) })
    section('Top performing units', report.topListings, { label: (r) => `${r.title}${r.unitCode ? ` (${r.unitCode})` : ''}`, value: (r) => formatMoney(r.collected) })
    section('Expenses by category', report.expenseByCategory, { label: (r) => r.category, value: (r) => `${formatMoney(r.amount)} (${r.percent.toFixed(0)}%)` })

    doc.end()
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
      where status not in ('cancelled', 'no_show') and check_out >= current_date
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

router.get('/export/workbook.xlsx', requireSuperAdmin, async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook()
    workbook.creator = 'Canwee Apartments'
    workbook.created = new Date()

    const bookingsSheet = workbook.addWorksheet('Bookings')
    bookingsSheet.columns = [
      { header: 'Booking Code', key: 'booking_code', width: 12 },
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
      { header: 'Expense Code', key: 'expense_code', width: 14 },
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
      select e.expense_code, e.expense_date, e.category, e.description, e.amount, l.title as listing_title,
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
