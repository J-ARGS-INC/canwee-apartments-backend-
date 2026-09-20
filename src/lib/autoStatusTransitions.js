import { pool } from '../db.js'
import { logAudit } from './auditLog.js'

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
  const { rows: checkedIn } = await pool.query(
    `update bookings set status = 'checked_in', actual_check_in_at = now()
     where status = 'confirmed' and check_in <= current_date
     returning id`,
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
    `update bookings set status = 'checked_out', actual_check_out_at = now()
     where status = 'checked_in' and check_out <= current_date
     returning id`,
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

  return { checkedIn: checkedIn.length, checkedOut: checkedOut.length }
}
