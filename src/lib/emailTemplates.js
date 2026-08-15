import { escapeHtml } from './validate.js'

// Table-based layout with fully inline styles — the only markup pattern
// that renders consistently across Gmail, Apple Mail, and Outlook's Word
// rendering engine (which ignores most <style> blocks and modern CSS).

const COLORS = {
  navy: '#1E40AF',
  ink: '#0F172A',
  muted: '#64748B',
  border: '#E2E8F0',
  section: '#F8FAFC',
  gold: '#EAB308',
  success: '#16A34A',
}

function shell(bodyHtml) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Canwee Apartments</title>
  </head>
  <body style="margin:0;padding:0;background:${COLORS.section};font-family:Arial,Helvetica,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.section};padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#FFFFFF;border-radius:16px;overflow:hidden;border:1px solid ${COLORS.border};">
            <tr>
              <td style="background:${COLORS.navy};padding:28px 32px;">
                <span style="font-family:Georgia,'Times New Roman',serif;font-size:20px;font-weight:700;color:#FFFFFF;">
                  Canwee <span style="color:${COLORS.gold};">Apartments</span>
                </span>
              </td>
            </tr>
            <tr>
              <td style="padding:32px;">
                ${bodyHtml}
              </td>
            </tr>
            <tr>
              <td style="background:${COLORS.section};padding:20px 32px;border-top:1px solid ${COLORS.border};">
                <p style="margin:0;font-size:12px;color:${COLORS.muted};">Canwee Apartments &middot; Lagos &amp; Abeokuta, Nigeria</p>
                <p style="margin:4px 0 0;font-size:12px;color:${COLORS.muted};">This is an automated message. Reply to this email and our team will see it.</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function summaryTable(rows) {
  const rowsHtml = rows
    .map(
      ([label, value]) => `
        <tr>
          <td style="padding:8px 0;font-size:13px;color:${COLORS.muted};border-bottom:1px solid ${COLORS.border};">${escapeHtml(label)}</td>
          <td style="padding:8px 0;font-size:13px;color:${COLORS.ink};font-weight:600;text-align:right;border-bottom:1px solid ${COLORS.border};">${value}</td>
        </tr>`,
    )
    .join('')

  return `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${COLORS.section};border-radius:12px;padding:4px 16px;margin:0 0 24px;">
      ${rowsHtml}
    </table>`
}

function ctaButton(href, label) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
      <tr>
        <td style="border-radius:999px;background:${COLORS.navy};">
          <a href="${href}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:600;color:#FFFFFF;text-decoration:none;">${escapeHtml(label)}</a>
        </td>
      </tr>
    </table>`
}

function statusBadge(text) {
  return `<span style="display:inline-block;background:#FEF3C7;color:#92400E;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;">${escapeHtml(text)}</span>`
}

export function bookingGuestConfirmationEmail({
  fullName,
  listingTitle,
  checkIn,
  checkOut,
  guests,
  pricePerNight,
  nights,
  bookingCode,
  statusUrl,
}) {
  const firstName = fullName.trim().split(/\s+/)[0]
  return shell(`
    <p style="margin:0 0 16px;font-size:16px;color:${COLORS.ink};">Hi ${escapeHtml(firstName)},</p>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#334155;">
      Thanks for booking with Canwee Apartments. We've received your request for
      <strong>${escapeHtml(listingTitle)}</strong> and a member of our team will confirm within 24 hours.
    </p>
    ${summaryTable([
      ['Check-in', escapeHtml(checkIn)],
      ['Check-out', escapeHtml(checkOut)],
      ['Guests', String(guests)],
      ['Rate', `${pricePerNight} &times; ${nights} night${nights > 1 ? 's' : ''}`],
      ['Status', statusBadge('Pending confirmation')],
      ['Booking code', `<span style="font-family:monospace;font-size:13px;font-weight:700;">${escapeHtml(bookingCode)}</span>`],
    ])}
    <p style="text-align:center;margin:0 0 20px;">
      ${ctaButton(statusUrl, 'Check your booking status')}
    </p>
    <p style="margin:0;font-size:13px;color:${COLORS.muted};text-align:center;">
      Save your booking code above. You can look up your status anytime.
    </p>
  `)
}

export function bookingAdminNotificationEmail({
  listingTitle,
  listingCity,
  checkIn,
  checkOut,
  guests,
  fullName,
  email,
  phone,
  notes,
  bookingCode,
  dashboardUrl,
}) {
  return shell(`
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${COLORS.navy};">New booking request</p>
    <p style="margin:0 0 20px;font-size:18px;font-weight:700;color:${COLORS.ink};">${escapeHtml(listingTitle)} &middot; ${escapeHtml(listingCity)}</p>
    ${summaryTable([
      ['Check-in', escapeHtml(checkIn)],
      ['Check-out', escapeHtml(checkOut)],
      ['Guests', String(guests)],
      ['Guest name', escapeHtml(fullName)],
      ['Email', escapeHtml(email)],
      ['Phone', escapeHtml(phone)],
      ...(notes ? [['Notes', escapeHtml(notes)]] : []),
      ['Booking code', `<span style="font-family:monospace;font-size:13px;font-weight:700;">${escapeHtml(bookingCode)}</span>`],
    ])}
    <p style="text-align:center;margin:0;">
      ${ctaButton(dashboardUrl, 'Open admin dashboard')}
    </p>
  `)
}

function bulletList(items) {
  if (items.length === 0) {
    return `<p style="margin:0 0 20px;font-size:13px;color:${COLORS.muted};">None.</p>`
  }
  const itemsHtml = items.map((item) => `<li style="margin:0 0 6px;font-size:13px;color:#334155;">${item}</li>`).join('')
  return `<ul style="margin:0 0 20px;padding-left:18px;">${itemsHtml}</ul>`
}

function sectionHeading(text) {
  return `<p style="margin:24px 0 8px;font-size:13px;font-weight:700;color:${COLORS.ink};">${escapeHtml(text)}</p>`
}

export function dailyDigestEmail({ dateLabel, checkInsToday, checkOutsToday, checkedInNow, upcoming48h, unpaidReserved, dashboardUrl }) {
  const stayLine = (b) => `<strong>${escapeHtml(b.full_name)}</strong> &middot; ${escapeHtml(b.listing_title)} (${escapeHtml(b.unit_code || b.listing_city)}) &middot; <span style="font-family:monospace;">${escapeHtml(b.booking_code)}</span>`
  const balanceLine = (b) => `${stayLine(b)} &middot; balance ${b.balance}`

  return shell(`
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${COLORS.navy};">Daily operations digest</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:${COLORS.ink};">${escapeHtml(dateLabel)}</p>

    ${sectionHeading(`Checking in today (${checkInsToday.length})`)}
    ${bulletList(checkInsToday.map(stayLine))}

    ${sectionHeading(`Checking out today (${checkOutsToday.length})`)}
    ${bulletList(checkOutsToday.map(stayLine))}

    ${sectionHeading(`Currently checked in (${checkedInNow.length})`)}
    ${bulletList(checkedInNow.map(stayLine))}

    ${sectionHeading(`Upcoming within 48 hours (${upcoming48h.length})`)}
    ${bulletList(upcoming48h.map((b) => `${stayLine(b)} &middot; ${escapeHtml(b.kind)} ${escapeHtml(b.date)}`))}

    ${sectionHeading(`Needs a payment follow-up (${unpaidReserved.length})`)}
    ${bulletList(unpaidReserved.map(balanceLine))}

    <p style="text-align:center;margin:24px 0 0;">
      ${ctaButton(dashboardUrl, 'Open admin dashboard')}
    </p>
  `)
}

export function weeklyDigestEmail({ weekLabel, report, checkInsCompleted, checkOutsCompleted, cancelledCount, noShowCount, dashboardUrl }) {
  const topUnit = report.topListings[0]
  const bottomUnit = report.bottomListings[0]
  return shell(`
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${COLORS.navy};">Weekly operations summary</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:${COLORS.ink};">${escapeHtml(weekLabel)}</p>
    ${summaryTable([
      ['Total bookings', String(report.totalBookings)],
      ['Revenue collected', `&#8358;${Math.round(report.totalCollected).toLocaleString('en-US')}`],
      ['Outstanding balance', `&#8358;${Math.round(report.totalOutstanding).toLocaleString('en-US')}`],
      ['Expenses recorded', `&#8358;${Math.round(report.totalExpenses).toLocaleString('en-US')}`],
      ['Check-ins completed', String(checkInsCompleted)],
      ['Check-outs completed', String(checkOutsCompleted)],
      ['Cancelled', String(cancelledCount)],
      ['No-shows', String(noShowCount)],
      ...(topUnit ? [['Highest booked unit', `${escapeHtml(topUnit.title)} (${escapeHtml(topUnit.unitCode || topUnit.city)})`]] : []),
      ...(bottomUnit ? [['Lowest activity unit', `${escapeHtml(bottomUnit.title)} (${escapeHtml(bottomUnit.unitCode || bottomUnit.city)})`]] : []),
    ])}
    <p style="text-align:center;margin:0;">
      ${ctaButton(dashboardUrl, 'Open full dashboard')}
    </p>
  `)
}

export function monthlyReportEmail({ monthLabel, report, paymentStatusCounts, dashboardUrl }) {
  const topUnit = report.topListings[0]
  const bottomUnit = report.bottomListings[0]
  const money = (n) => `&#8358;${Math.round(n).toLocaleString('en-US')}`

  return shell(`
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${COLORS.navy};">Monthly business report</p>
    <p style="margin:0 0 16px;font-size:18px;font-weight:700;color:${COLORS.ink};">${escapeHtml(monthLabel)}</p>
    ${summaryTable([
      ['Total bookings', String(report.totalBookings)],
      ['Total revenue', money(report.totalRevenue)],
      ['Total collected', money(report.totalCollected)],
      ['Outstanding balance', money(report.totalOutstanding)],
      ['Total expenses', money(report.totalExpenses)],
      ['Net profit', money(report.netIncome)],
      ...(topUnit ? [['Best-performing unit', `${escapeHtml(topUnit.title)} (${escapeHtml(topUnit.unitCode || topUnit.city)}) &mdash; ${money(topUnit.collected)}`]] : []),
      ...(bottomUnit ? [['Least-performing unit', `${escapeHtml(bottomUnit.title)} (${escapeHtml(bottomUnit.unitCode || bottomUnit.city)}) &mdash; ${money(bottomUnit.collected)}`]] : []),
    ])}

    ${sectionHeading('Revenue by location')}
    ${bulletList(report.byLocation.map((r) => `${escapeHtml(r.location)}: ${money(r.collected)}`))}

    ${sectionHeading('Expenses by category')}
    ${bulletList(report.expenseByCategory.map((r) => `${escapeHtml(r.category)}: ${money(r.amount)} (${r.percent.toFixed(0)}%)`))}

    ${sectionHeading('Payment status')}
    ${bulletList([
      `Fully paid: ${paymentStatusCounts.paid || 0}`,
      `Part payment: ${paymentStatusCounts.part_payment || 0}`,
      `Unpaid: ${paymentStatusCounts.unpaid || 0}`,
    ])}

    ${sectionHeading('Booking outcomes')}
    ${bulletList(report.byStatus.map((r) => `${escapeHtml(r.status.replace('_', ' '))}: ${r.bookings}`))}

    <p style="text-align:center;margin:24px 0 0;">
      ${ctaButton(dashboardUrl, 'Open full dashboard')}
    </p>
  `)
}

export function contactAdminNotificationEmail({ name, email, topic, message, receivedAt }) {
  return shell(`
    <p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:0.05em;text-transform:uppercase;color:${COLORS.navy};">New contact message</p>
    <p style="margin:0 0 20px;font-size:18px;font-weight:700;color:${COLORS.ink};">${escapeHtml(topic)}</p>
    ${summaryTable([
      ['From', escapeHtml(name)],
      ['Email', escapeHtml(email)],
      ['Received', escapeHtml(receivedAt)],
    ])}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-left:3px solid ${COLORS.navy};margin:0;">
      <tr>
        <td style="padding:4px 0 4px 16px;font-size:14px;line-height:1.6;color:#334155;">${escapeHtml(message).replace(/\n/g, '<br/>')}</td>
      </tr>
    </table>
  `)
}
