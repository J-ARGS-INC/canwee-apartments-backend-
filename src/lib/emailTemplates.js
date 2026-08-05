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
