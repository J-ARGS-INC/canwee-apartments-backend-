import { pool } from '../db.js'
import { buildSummaryReport } from './reports.js'
import { sendEmailTo, getDigestRecipients, ADMIN_DASHBOARD_URL } from './notify.js'
import { dailyDigestEmail, weeklyDigestEmail, monthlyReportEmail } from './emailTemplates.js'

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
  const [checkInsToday, checkOutsToday, checkedInNow, upcomingCheckIns, upcomingCheckOuts, unpaidReserved, overduePending] =
    await Promise.all([
      fetchStays("status in ('pending','confirmed') and check_in = current_date"),
      fetchStays("status = 'checked_in' and check_out = current_date"),
      fetchStays("status = 'checked_in'"),
      // 7 days, not 48h — keeps the "Upcoming" section operational without
      // being so short it misses next week's prep, per the operator's
      // explicit call for 7 over a longer window.
      fetchStays("status in ('pending','confirmed') and check_in > current_date and check_in <= current_date + interval '7 days'"),
      fetchStays("status = 'checked_in' and check_out > current_date and check_out <= current_date + interval '7 days'"),
      fetchStays("status in ('pending','confirmed') and payment_status in ('unpaid','part_payment')"),
      // Never auto-progressed by the nightly cron (see autoStatusTransitions.js)
      // — surfaced here so it doesn't just sit invisible in the admin UI.
      fetchStays("status = 'pending' and check_in < current_date"),
    ])

  const upcoming7d = [
    ...upcomingCheckIns.map((b) => ({ ...b, kind: 'check-in', date: b.check_in })),
    ...upcomingCheckOuts.map((b) => ({ ...b, kind: 'check-out', date: b.check_out })),
  ]

  const [{ rows: unitCountRows }, { rows: expenseRows }, { rows: paymentRows }] = await Promise.all([
    pool.query('select count(*)::int as n from listings'),
    pool.query(
      `select
        coalesce(sum(amount) filter (where expense_date = current_date - 1), 0) as yesterday,
        coalesce(sum(amount) filter (where expense_date = current_date), 0) as today
       from expenses where deleted_at is null`,
    ),
    // "Amount expected today" = today's stays' total_amount; "received
    // today" = payments actually logged today (payment_date, not
    // booking-creation date) — two different things worth showing side by
    // side rather than conflating.
    pool.query(
      `select
        coalesce(sum(total_amount) filter (where check_in = current_date and status != 'cancelled'), 0) as expected_today,
        (select coalesce(sum(amount), 0) from payments where payment_date = current_date) as received_today
       from bookings`,
    ),
  ])
  const totalUnits = unitCountRows[0].n
  const occupiedCount = checkedInNow.length
  const availableCount = Math.max(0, totalUnits - occupiedCount)

  const dateLabel = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  await sendEmailTo(await getDigestRecipients('daily_digest_emails'), {
    subject: `Daily digest: ${checkInsToday.length} check-in(s), ${checkOutsToday.length} check-out(s) today`,
    html: dailyDigestEmail({
      dateLabel,
      checkInsToday,
      checkOutsToday,
      checkedInNow,
      occupiedCount,
      availableCount,
      totalUnits,
      upcoming7d,
      unpaidReserved,
      overduePending,
      expectedToday: Number(paymentRows[0].expected_today),
      receivedToday: Number(paymentRows[0].received_today),
      expensesYesterday: Number(expenseRows[0].yesterday),
      expensesToday: Number(expenseRows[0].today),
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

  // Who cancelled and why, for the week — uses the mandatory-reason
  // cancellation columns added for non-super-admin cancellations; a super
  // admin's own cancellation may have no reason, shown as such.
  const { rows: cancellations } = await pool.query(
    `select b.booking_code, b.full_name, b.cancellation_reason, au.display_name as cancelled_by_name
     from bookings b left join admin_users au on au.id = b.cancelled_by
     where b.status = 'cancelled' and b.cancelled_at::date between $1 and $2
     order by b.cancelled_at`,
    [startDate, endDate],
  )

  const upcoming7dRows = await fetchStays(
    "status in ('pending','confirmed') and check_in > current_date and check_in <= current_date + interval '7 days'",
  )

  const weekLabel = `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`

  await sendEmailTo(await getDigestRecipients('weekly_digest_emails'), {
    subject: `Weekly summary: ${weekLabel}`,
    html: weeklyDigestEmail({
      weekLabel,
      report,
      checkInsCompleted: Number(activity[0].check_ins_completed),
      checkOutsCompleted: Number(activity[0].check_outs_completed),
      cancelledCount: Number(activity[0].cancelled_count),
      noShowCount: Number(activity[0].no_show_count),
      cancellations,
      upcoming7d: upcoming7dRows,
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

  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 2, 1)
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth() - 1, 0)

  const [report, previousReport] = await Promise.all([
    buildSummaryReport({ startDate, endDate }),
    buildSummaryReport({ startDate: toDateKey(prevMonthStart), endDate: toDateKey(prevMonthEnd) }),
  ])

  const [{ rows: paymentRows }, { rows: statsRows }, { rows: expenseByListingRows }, { rows: unitCountRows }, upcomingNextMonth] =
    await Promise.all([
      pool.query(
        `select payment_status, count(*) as bookings
         from bookings
         where status != 'cancelled' and check_in >= $1 and check_in <= $2
         group by payment_status`,
        [startDate, endDate],
      ),
      pool.query(
        `select
          count(*) filter (where status = 'cancelled' and cancelled_at::date between $1 and $2) as cancellation_count,
          coalesce(avg(check_out - check_in) filter (where status != 'cancelled' and check_in between $1 and $2), 0) as avg_nights,
          coalesce(sum(check_out - check_in) filter (where status != 'cancelled' and check_in between $1 and $2), 0) as occupied_nights
         from bookings`,
        [startDate, endDate],
      ),
      // Per-unit expenses — distinct from report.expenseByLocation, which
      // is location/area-scoped only. Rows with no listing_id (a location-
      // or area-general expense) are intentionally excluded here, same
      // reasoning as expenseByLocation excluding the pre-migration
      // unclassified rows: this section answers "which apartment", not
      // "which broader area".
      pool.query(
        `select l.title, l.unit_code, coalesce(sum(e.amount), 0) as amount
         from expenses e join listings l on l.id = e.listing_id
         where e.deleted_at is null and e.expense_date >= $1 and e.expense_date <= $2
         group by l.id, l.title, l.unit_code
         order by amount desc`,
        [startDate, endDate],
      ),
      pool.query('select count(*)::int as n from listings'),
      fetchStays(`status in ('pending','confirmed') and check_in >= date_trunc('month', current_date)::date and check_in < (date_trunc('month', current_date) + interval '1 month')::date`),
    ])
  const paymentStatusCounts = Object.fromEntries(paymentRows.map((r) => [r.payment_status, Number(r.bookings)]))
  const daysInMonth = Math.round((monthEnd - monthStart) / (1000 * 60 * 60 * 24)) + 1
  const totalUnits = unitCountRows[0].n
  const occupancyRate = totalUnits > 0 ? (Number(statsRows[0].occupied_nights) / (totalUnits * daysInMonth)) * 100 : 0

  const monthLabel = monthStart.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  await sendEmailTo(await getDigestRecipients('monthly_digest_emails'), {
    subject: `Monthly report: ${monthLabel}`,
    html: monthlyReportEmail({
      monthLabel,
      report,
      previousReport,
      paymentStatusCounts,
      cancellationCount: Number(statsRows[0].cancellation_count),
      averageLengthOfStay: Number(statsRows[0].avg_nights),
      occupancyRate,
      expenseByListing: expenseByListingRows,
      upcomingNextMonth,
      dashboardUrl: ADMIN_DASHBOARD_URL,
    }),
  })
}
