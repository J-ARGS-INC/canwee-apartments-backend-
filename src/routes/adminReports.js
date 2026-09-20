import { Router } from 'express'
import ExcelJS from 'exceljs'
import PDFDocument from 'pdfkit'
import { pool } from '../db.js'
import { requireAdmin, requireSuperAdmin } from '../middleware/adminAuth.js'
import { adminLimiter } from '../middleware/rateLimiters.js'
import { buildSummaryReport } from '../lib/reports.js'
import { getLocationTree, getFilterLabel, parseLocationFilter } from '../lib/hierarchy.js'
import { sendDailyDigest, sendWeeklyDigest, sendMonthlyReport } from '../lib/scheduledReports.js'

const DIGEST_SENDERS = { daily: sendDailyDigest, weekly: sendWeeklyDigest, monthly: sendMonthlyReport }

const router = Router()

router.use(requireAdmin)
router.use(adminLimiter)

// Financial/audit visibility is super-admin-only per the access-control
// spec — staff get operational routes (availability) but not money or the
// audit trail. /availability deliberately stays on plain requireAdmin
// since staff need it for day-to-day check-in/check-out work.
// Batch-fetches minimal display context (booking code/guest, expense code/
// category, admin display name...) for one page of audit_log rows, so the
// frontend can render a full human sentence ("Tomiwa cancelled booking
// IKE-0045 for Mr Femi...") instead of a raw entity_type + truncated id.
// One targeted query per entity_type actually present on the page — same
// multi-query-merged-in-JS pattern lib/reports.js's buildSummaryReport
// already uses, not a new idiom for this codebase.
async function enrichAuditRows(rows) {
  const actorIds = [...new Set(rows.map((r) => r.actor).filter((a) => a && a !== 'system'))]
  const bookingIds = [...new Set(rows.filter((r) => r.entity_type === 'booking').map((r) => r.entity_id))]
  const expenseIds = [...new Set(rows.filter((r) => r.entity_type === 'expense').map((r) => r.entity_id))]
  const adminUserIds = [...new Set(rows.filter((r) => r.entity_type === 'admin_user').map((r) => r.entity_id))]
  const paymentIds = [...new Set(rows.filter((r) => r.entity_type === 'payment').map((r) => r.entity_id))]

  const [actorRows, bookingRows, expenseRows, adminUserRows, paymentRows] = await Promise.all([
    actorIds.length
      ? pool.query('select id, display_name from admin_users where id = any($1)', [actorIds])
      : { rows: [] },
    bookingIds.length
      ? pool.query(
          `select b.id, b.booking_code, b.full_name, l.title as listing_title, l.unit_code
           from bookings b join listings l on l.id = b.listing_id where b.id = any($1)`,
          [bookingIds],
        )
      : { rows: [] },
    expenseIds.length
      ? pool.query(
          `select e.id, e.expense_code, e.category, l.title as listing_title, l.unit_code
           from expenses e left join listings l on l.id = e.listing_id where e.id = any($1)`,
          [expenseIds],
        )
      : { rows: [] },
    adminUserIds.length
      ? pool.query('select id, display_name from admin_users where id = any($1)', [adminUserIds])
      : { rows: [] },
    paymentIds.length
      ? pool.query(
          `select p.id, b.booking_code, b.full_name
           from payments p join bookings b on b.id = p.booking_id where p.id = any($1)`,
          [paymentIds],
        )
      : { rows: [] },
  ])

  const actorNameById = new Map(actorRows.rows.map((r) => [r.id, r.display_name]))
  const bookingById = new Map(bookingRows.rows.map((r) => [r.id, r]))
  const expenseById = new Map(expenseRows.rows.map((r) => [r.id, r]))
  const adminUserById = new Map(adminUserRows.rows.map((r) => [r.id, r]))
  const paymentById = new Map(paymentRows.rows.map((r) => [r.id, r]))

  return rows.map((r) => ({
    ...r,
    actorName: r.actor === 'system' ? 'System' : actorNameById.get(r.actor) || null,
    booking: bookingById.get(r.entity_id) || null,
    expense: expenseById.get(r.entity_id) || null,
    adminUser: adminUserById.get(r.entity_id) || null,
    payment: paymentById.get(r.entity_id) || null,
  }))
}

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
    res.json(await enrichAuditRows(rows))
  } catch (err) {
    next(err)
  }
})

router.get('/reports/summary', requireSuperAdmin, async (req, res, next) => {
  try {
    const { startDate, endDate, location } = req.query
    res.json(await buildSummaryReport({ startDate, endDate, locationFilter: parseLocationFilter(location) }))
  } catch (err) {
    next(err)
  }
})

// Location -> Area -> Unit tree, feeding the expense form's scope picker and
// the Analytics/Payment Summary location filters (see lib/hierarchy.js).
router.get('/locations', async (req, res, next) => {
  try {
    res.json(await getLocationTree())
  } catch (err) {
    next(err)
  }
})

// Manually fires one of the three scheduled digest emails on demand — same
// underlying send functions the nightly cron calls, just triggered by a
// super admin instead of the clock. Useful for testing a config/recipient
// change immediately instead of waiting for the next scheduled run, and
// must be triggered from wherever this server is actually deployed — the
// Brevo account only accepts sends from an authorized IP, so this can't be
// exercised from an arbitrary machine, only from the running service.
router.post('/digests/:type/send', requireSuperAdmin, async (req, res, next) => {
  try {
    const sendFn = DIGEST_SENDERS[req.params.type]
    if (!sendFn) return res.status(400).json({ error: `Unknown digest type "${req.params.type}".` })
    await sendFn()
    res.json({ sent: true })
  } catch (err) {
    next(err)
  }
})

function formatMoney(amount) {
  return `NGN ${Math.round(amount).toLocaleString('en-US')}`
}

router.get('/export/summary.pdf', requireSuperAdmin, async (req, res, next) => {
  try {
    const { startDate, endDate, location } = req.query
    const locationFilter = parseLocationFilter(location)
    const report = await buildSummaryReport({ startDate, endDate, locationFilter })

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="canwee-summary-${new Date().toISOString().slice(0, 10)}.pdf"`)

    const doc = new PDFDocument({ margin: 50, size: 'A4' })
    doc.pipe(res)

    doc.fontSize(18).font('Helvetica-Bold').text('Canwee Apartments: Payment Summary')
    const periodLabel = startDate || endDate ? `${startDate || 'inception'} to ${endDate || 'today'}` : 'All time'
    const locationLabel = (await getFilterLabel(locationFilter)) || 'All locations'
    doc
      .fontSize(10)
      .font('Helvetica')
      .fillColor('#666')
      .text(`Period: ${periodLabel}  ·  Location: ${locationLabel}  ·  Generated ${new Date().toLocaleString('en-US')}`)
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
        doc.fillColor('#333').text(`${columns.label(row)}: ${columns.value(row)}`)
      }
    }

    section('Revenue by location', report.byLocation, { label: (r) => r.location, value: (r) => formatMoney(r.collected) })
    section('Bookings by location', report.byLocation, { label: (r) => r.location, value: (r) => String(r.bookings) })
    section('Expenses by location', report.expenseByLocation, { label: (r) => r.location, value: (r) => formatMoney(r.amount) })
    section('Net profit by location', report.netProfitByLocation, { label: (r) => r.location, value: (r) => formatMoney(r.netProfit) })
    section('Bookings by source & location', report.bySourceByLocation, {
      label: (r) => `${r.location} · ${r.sourceChannel}`,
      value: (r) => String(r.bookings),
    })
    section('Bookings by agent', report.byAgent, {
      label: (r) => `${r.agentName}${r.agentPhone ? ` (${r.agentPhone})` : ''}`,
      value: (r) => `${r.bookings} · ${formatMoney(r.collected)}`,
    })
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
    // Two modes: with no month/year given, "today onward, unbounded" — the
    // original default behavior, still exactly what the per-unit upcoming-
    // stays cards in AvailabilityTab want (unaffected by the fix below).
    // With an explicit month/year, scoped to exactly that calendar month
    // via the daterange overlap operator already used by the DB's own
    // booking-overlap constraint, with no lower bound — so a past month is
    // just as queryable as the current or a future one. This is what
    // AvailabilityCalendar.jsx now calls when browsing, replacing the old
    // hardcoded "check_out >= current_date" filter, which silently dropped
    // every past booking from the response no matter which month was
    // being viewed.
    let bookingCondition = "status not in ('cancelled', 'no_show') and check_out >= current_date"
    const bookingParams = []
    if (req.query.month || req.query.year) {
      const now = new Date()
      const year = Math.max(2000, Math.min(3000, Number(req.query.year) || now.getFullYear()))
      const month = Math.max(1, Math.min(12, Number(req.query.month) || now.getMonth() + 1))
      bookingParams.push(`${year}-${String(month).padStart(2, '0')}-01`)
      bookingCondition =
        "status not in ('cancelled', 'no_show') and stay_range && daterange($1::date, ($1::date + interval '1 month')::date, '[)')"
    }

    const { rows: listingsRows } = await pool.query(
      `select id, title, city, unit_code from listings order by city, title`,
    )
    const { rows: bookingRows } = await pool.query(
      `select listing_id, check_in, check_out, status, full_name
       from bookings
       where ${bookingCondition}
       order by check_in`,
      bookingParams,
    )

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

    // Excludes cancelled bookings, same as buildSummaryReport (reports.js)
    // — this is a separate query (the full unfiltered workbook export, not
    // the date/location-scoped JSON summary) but needs the identical
    // definition so the two never disagree about what counts as revenue.
    // The caution fee is collected separately, offline, and never added
    // into total_amount/amount_paid, so no exclusion math is needed here.
    const { rows: totals } = await pool.query(`
      select coalesce(sum(total_amount) filter (where status != 'cancelled'), 0) as total_revenue,
             coalesce(sum(amount_paid) filter (where status != 'cancelled'), 0) as total_collected,
             coalesce(sum(balance) filter (where status != 'cancelled'), 0) as total_outstanding
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
