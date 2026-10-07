import { pool } from '../db.js'

// Single source for "booking id -> guest/unit display info" (booking code,
// guest name, unit title/code) — anywhere a live notification email or the
// Activity Log needs to show a booking in human terms, it comes from here
// instead of each call site writing its own copy of the same join.

export async function getBookingDisplayInfo(id) {
  const { rows } = await pool.query(
    `select b.booking_code, b.full_name, l.title as listing_title, l.unit_code
     from bookings b join listings l on l.id = b.listing_id where b.id = $1`,
    [id],
  )
  return rows[0] || null
}

// Same lookup, batched for the N-id case (audit-log enrichment) — one
// query with `= any($1)` rather than one query per id.
export async function getBookingDisplayInfoBatch(ids) {
  if (ids.length === 0) return new Map()
  const { rows } = await pool.query(
    `select b.id, b.booking_code, b.full_name, l.title as listing_title, l.unit_code
     from bookings b join listings l on l.id = b.listing_id where b.id = any($1)`,
    [ids],
  )
  return new Map(rows.map((r) => [r.id, r]))
}
