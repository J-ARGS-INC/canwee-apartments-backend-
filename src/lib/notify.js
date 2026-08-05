const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

function getAdminRecipients() {
  return (process.env.NOTIFY_EMAILS || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
    .map((email) => ({ email }))
}

// Fire-and-forget from the caller's point of view: a failed send should
// never fail the booking/contact request itself, so this only logs.
async function sendEmail({ to, subject, html }) {
  const apiKey = process.env.BREVO_API_KEY
  if (!apiKey || to.length === 0) {
    console.warn('Email skipped: BREVO_API_KEY not set or no recipients.')
    return
  }

  try {
    const res = await fetch(BREVO_API_URL, {
      method: 'POST',
      headers: {
        'api-key': apiKey,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        sender: {
          name: process.env.BREVO_FROM_NAME || 'Canwee Apartments',
          email: process.env.BREVO_FROM_EMAIL,
        },
        to,
        subject,
        htmlContent: html,
      }),
    })

    if (!res.ok) {
      console.error('Email send failed:', res.status, await res.text())
    }
  } catch (err) {
    console.error('Email send failed:', err)
  }
}

// Sent to the fixed internal team list (NOTIFY_EMAILS) — new bookings, new
// contact messages, anything the business needs to act on.
export function sendNotificationEmail({ subject, html }) {
  return sendEmail({ to: getAdminRecipients(), subject, html })
}

// Sent to a single guest/customer address, e.g. their booking confirmation.
export function sendCustomerEmail({ to, name, subject, html }) {
  return sendEmail({ to: [{ email: to, name }], subject, html })
}
