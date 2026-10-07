import { pool } from '../db.js'
import { logAudit } from './auditLog.js'
import { sendNotificationEmail, ADMIN_DASHBOARD_URL } from './notify.js'
import { autoStatusSummaryEmail } from './emailTemplates.js'

// Confirmed-only, per the operator's decision: a `pending` booking whose
// check-in date has passed is never silently auto-progressed (it stays
// pending and is surfaced as needing attention elsewhere — see
// BookingsTab.jsx's overdue-pending flag and the daily digest) — only a
// booking staff already confirmed advances automatically. Manual Check In/
// Check Out buttons stay fully available as an override for both cases;
// this only ever touches rows still sitting in 'confirmed'/'checked_in',
// so anything already manually progressed is naturally skipped, no risk of
// clobbering a manual action.
export async function runAutoStatusTransitions() {
  // Sequential so a booking whose check-in AND check-out both already
  // passed (e.g. the cron didn't run for a few days) catches up correctly
  // in one run instead of needing two separate days to progress through
  // both transitions.
  // `update ... from listings` so the summary email below has the guest
  // name/unit without a separate follow-up query per row.
  const { rows: checkedIn } = await pool.query(
    `update bookings b set status = 'checked_in', actual_check_in_at = now()
     from listings l
     where b.listing_id = l.id and b.status = 'confirmed' and b.check_in <= current_date
     returning b.id, b.booking_code, b.full_name, l.title, l.unit_code`,
  )
  for (const row of checkedIn) {
    logAudit({
      entityType: 'booking',
      entityId: row.id,
      action: 'status_change',
      changes: { status: { old: 'confirmed', new: 'checked_in' } },
      actor: 'system',
    })
  }

  const { rows: checkedOut } = await pool.query(
    `update bookings b set status = 'checked_out', actual_check_out_at = now()
     from listings l
     where b.listing_id = l.id and b.status = 'checked_in' and b.check_out <= current_date
     returning b.id, b.booking_code, b.full_name, l.title, l.unit_code`,
  )
  for (const row of checkedOut) {
    logAudit({
      entityType: 'booking',
      entityId: row.id,
      action: 'status_change',
      changes: { status: { old: 'checked_in', new: 'checked_out' } },
      actor: 'system',
    })
  }

  // One summary email for the whole run, not one per booking — a quiet
  // night sends nothing at all, a busy one doesn't spam an inbox with
  // several separate messages.
  if (checkedIn.length > 0 || checkedOut.length > 0) {
    sendNotificationEmail({
      subject: `Automatic check-in/check-out: ${checkedIn.length} in, ${checkedOut.length} out`,
      html: autoStatusSummaryEmail({ checkedIn, checkedOut, dashboardUrl: ADMIN_DASHBOARD_URL }),
    })
  }

  return { checkedIn: checkedIn.length, checkedOut: checkedOut.length }
}
