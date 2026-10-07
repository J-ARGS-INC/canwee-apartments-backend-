import { getSetting } from './settings.js'

const BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'

// Shared "open admin dashboard" link for every outbound email — scheduled
// digests and the live per-action notifications alike.
export const ADMIN_DASHBOARD_URL = process.env.ADMIN_DASHBOARD_URL || process.env.FRONTEND_URL || 'https://canweeapartments.com'

function envRecipients() {
  return (process.env.NOTIFY_EMAILS || '')
    .split(',')
    .map((email) => email.trim())
    .filter(Boolean)
}

// Always included on every outbound notification, regardless of what a
// super admin has since changed in Settings — the operator's explicit
// request for a guaranteed-delivery baseline (2026-10-07, after the
// notify_emails setting lost an address and a digest only reached one
// person as a result).
const ALWAYS_NOTIFY = ['echteedee2@gmail.com', 'emoawosejoshua@gmail.com']

// Union of three sources, not a fallback chain: the hardcoded baseline
// above, NOTIFY_EMAILS (support@/jargsltd@ — previously only used when the
// DB setting was empty, now always included), and whatever a super admin
// has added via Settings. Editing the setting only ever adds recipients
// here, never removes the guaranteed ones.
async function getAdminRecipients() {
  const stored = await getSetting('notify_emails')
  const fromSettings = Array.isArray(stored) ? stored : []
  const emails = [...new Set([...ALWAYS_NOTIFY, ...envRecipients(), ...fromSettings])]
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
