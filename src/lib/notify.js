import { getSetting } from './settings.js'

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

function envRecipients() {
  return (process.env.NOTIFY_EMAILS || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
}

// Reads from the DB setting a super admin can actually edit (SettingsTab),
// falling back to the NOTIFY_EMAILS env var only when that setting is
// empty/unset — previously this always read the env var and ignored the
// setting entirely, so editing it in the UI had no effect on real
// delivery. Used for booking/contact-form alerts, and always merged into
// each digest's own recipient list below (never just a fallback for the
// digests — the default list gets every digest too, on top of whichever
// dedicated addresses are also configured).
async function getAdminRecipients() {
  const stored = await getSetting('notify_emails')
  const emails = Array.isArray(stored) && stored.length > 0 ? stored : envRecipients()
  return emails.map((email) => ({ email }))
}

// key: 'daily_digest_emails' | 'weekly_digest_emails' | 'monthly_digest_emails'
// Always sends to BOTH this digest's own list AND the default notify_emails
// list, deduplicated — not a fallback (the default list gets the digest
// regardless of whether a dedicated list is also set), per the operator's
// explicit instruction that the default recipients must always be included.
export async function getDigestRecipients(key) {
  const [stored, defaults] = await Promise.all([getSetting(key), getAdminRecipients()])
  const dedicated = Array.isArray(stored) ? stored : []
  const emails = [...new Set([...dedicated, ...defaults.map((r) => r.email)])]
  return emails.map((email) => ({ email }))
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

// Sent to the internal team list (notify_emails setting, env fallback) —
// new bookings, new contact messages, anything the business needs to act on.
export async function sendNotificationEmail({ subject, html }) {
  return sendEmail({ to: await getAdminRecipients(), subject, html })
}

// Used by scheduledReports.js, whose three digests each have their own
// recipient list (getDigestRecipients above) instead of the shared one.
export function sendEmailTo(to, { subject, html }) {
  return sendEmail({ to, subject, html })
}

// Sent to a single guest/customer address, e.g. their booking confirmation.
export function sendCustomerEmail({ to, name, subject, html }) {
  return sendEmail({ to: [{ email: to, name }], subject, html })
}
