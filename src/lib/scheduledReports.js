import { pool } from '../db.js'
import { buildSummaryReport } from './reports.js'
import { sendNotificationEmail } from './notify.js'
import { dailyDigestEmail, weeklyDigestEmail, monthlyReportEmail } from './emailTemplates.js'

const ADMIN_DASHBOARD_URL = process.env.ADMIN_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://canweeapartments.com'

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

async function fetchStays(condition, params = []) {
  const { rows } = await pool.query(
    `select b.full_name, b.booking_code, b.balance, b.check_in, b.check_out,
            l.title as listing_title, l.unit_code, l.city as listing_city
     from bookings b join listings l on l.id = b.listing_id
     where ${condition}
     order by b.check_in`,
    params,
  )
  return rows
}

// Every operational thing reception/the owner needs to act on today,
// unconditionally sent (even an all-clear day is worth confirming) —
// mirrors the "Right now" tiles on the dashboard, but pushed to email
// instead of requiring someone to open the admin area.
export async function sendDailyDigest() {
  const [checkInsToday, checkOutsToday, checkedInNow, upcomingCheckIns, upcomingCheckOuts, unpaidReserved] = await Promise.all([
    fetchStays("status in ('pending','confirmed') and check_in = current_date"),
    fetchStays("status = 'checked_in' and check_out = current_date"),
    fetchStays("status = 'checked_in'"),
    fetchStays("status in ('pending','confirmed') and check_in > current_date and check_in <= current_date + interval '2 days'"),
    fetchStays("status = 'checked_in' and check_out > current_date and check_out <= current_date + interval '2 days'"),
    fetchStays("status in ('pending','confirmed') and payment_status in ('unpaid','part_payment')"),
  ])

  const upcoming48h = [
    ...upcomingCheckIns.map((b) => ({ ...b, kind: 'check-in', date: b.check_in })),
    ...upcomingCheckOuts.map((b) => ({ ...b, kind: 'check-out', date: b.check_out })),
  ]

  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  await sendNotificationEmail({
    subject: `Daily digest — ${checkInsToday.length} check-in(s), ${checkOutsToday.length} check-out(s) today`,
    html: dailyDigestEmail({
      dateLabel,
      checkInsToday,
      checkOutsToday,
      checkedInNow,
      upcoming48h,
      unpaidReserved,
      dashboardUrl: ADMIN_DASHBOARD_URL,
    }),
  })
}

function trailingWeekRange() {
  const now = new Date()
  // A trailing 7-day window ending today, not a fixed Mon–Sun calendar
  // week — this runs Saturday evening (mid-week from a calendar-week point
  // of view), so "the week" means "the last 7 days," independent of which
  // day it actually fires on.
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const start = new Date(end)
  start.setDate(start.getDate() - 6)
  return { start, end }
}

// Sent every Saturday night, covering the trailing 7 days.
export async function sendWeeklyDigest() {
  const { start, end } = trailingWeekRange()
  const startDate = toDateKey(start)
  const endDate = toDateKey(end)

  const report = await buildSummaryReport({ startDate, endDate })

  // Completed check-ins/outs and cancellations are counted by when the
  // event actually happened (actual_check_in_at / actual_check_out_at /
  // updated_at), not by the stay's original check_in/check_out date —
  // report.byStatus above is scoped to check_in date and would miss, e.g.,
  // a guest who checked out this week for a stay that began last month.
  const { rows: activity } = await pool.query(
    `select
      count(*) filter (where actual_check_in_at::date between $1 and $2) as check_ins_completed,
      count(*) filter (where actual_check_out_at::date between $1 and $2) as check_outs_completed,
      count(*) filter (where status = 'cancelled' and updated_at::date between $1 and $2) as cancelled_count,
      count(*) filter (where status = 'no_show' and updated_at::date between $1 and $2) as no_show_count
    from bookings`,
    [startDate, endDate],
  )

  const weekLabel = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  await sendNotificationEmail({
    subject: `Weekly summary — ${weekLabel}`,
    html: weeklyDigestEmail({
      weekLabel,
      report,
      checkInsCompleted: Number(activity[0].check_ins_completed),
      checkOutsCompleted: Number(activity[0].check_outs_completed),
      cancelledCount: Number(activity[0].cancelled_count),
      noShowCount: Number(activity[0].no_show_count),
      dashboardUrl: ADMIN_DASHBOARD_URL,
    }),
  })
}

// Sent on the 1st of the month, covering the just-finished calendar month
// (run on 2026-06-01, this reports all of May).
export async function sendMonthlyReport() {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const monthEnd = new Date(now.getFullYear(), now.getMonth(), 0)
  const startDate = toDateKey(monthStart)
  const endDate = toDateKey(monthEnd)

  const report = await buildSummaryReport({ startDate, endDate })

  const { rows: paymentRows } = await pool.query(
    `select payment_status, count(*) as bookings
     from bookings
     where status != 'cancelled' and check_in >= $1 and check_in <= $2
     group by payment_status`,
    [startDate, endDate],
  )
  const paymentStatusCounts = Object.fromEntries(paymentRows.map((r) => [r.payment_status, Number(r.bookings)]))

  const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  await sendNotificationEmail({
    subject: `Monthly report — ${monthLabel}`,
    html: monthlyReportEmail({ monthLabel, report, paymentStatusCounts, dashboardUrl: ADMIN_DASHBOARD_URL }),
  })
}
