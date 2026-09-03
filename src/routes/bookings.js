import { Router } from 'express'
import { pool } from '../db.js'
import { isValidDate, isValidEmail, maxLength, requireString } from '../lib/validate.js'
import { sendCustomerEmail, sendNotificationEmail } from '../lib/notify.js'
import { bookingAdminNotificationEmail, bookingGuestConfirmationEmail } from '../lib/emailTemplates.js'
import { createSubmissionLimiter, bookingLookupLimiter } from '../middleware/rateLimiters.js'
import { idempotent } from '../middleware/idempotency.js'

const router = Router()

// Matches the codes set_booking_code() generates in schema.sql: an
// operator-chosen prefix (their existing per-unit convention, e.g. IKE,
// ABE) plus a zero-padded sequence number. Checked before ever touching
// the database so a malformed guess is rejected for free.
const BOOKING_CODE_PATTERN = /^[A-Z0-9]{2,10}-\d{3,8}$/

const FRONTEND_URL = process.env.FRONTEND_URL || 'https://canweeapartments.com'
const ADMIN_DASHBOARD_URL = process.env.ADMIN_DASHBOARD_URL || FRONTEND_URL

function formatNaira(amount) {
  return new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(
    amount,
  )
}

function nightsBetween(checkIn, checkOut) {
  const ms = new Date(checkOut) - new Date(checkIn)
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)))
}

// "Today" for a past-date check needs to mean Lagos's calendar day, not the
// server process's own timezone (which runs on UTC in production) — WAT is
// a fixed UTC+1 with no DST, so shifting the clock forward an hour before
// taking the date portion reliably gives Lagos's date regardless of what
// timezone this process happens to run in. Using plain UTC "today" here
// would let a guest booking in the first hour after midnight WAT submit a
// check-in date that has already passed for them locally.
function todayInLagos() {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString().slice(0, 10)
}

router.post('/', createSubmissionLimiter(), idempotent(), async (req, res, next) => {
  try {
    const { listingId, fullName, email, phone, checkIn, checkOut, guests, notes } = req.body ?? {}

    const errors = {}
    requireString(listingId, 'listingId', errors)
    requireString(fullName, 'fullName', errors)
    requireString(phone, 'phone', errors)
    maxLength(fullName, 'fullName', 200, errors)
    maxLength(phone, 'phone', 30, errors)
    maxLength(email, 'email', 200, errors)
    maxLength(notes, 'notes', 2000, errors)

    const today = todayInLagos()
    if (!isValidDate(checkIn)) {
      errors.checkIn = 'Enter a valid check-in date.'
    } else if (checkIn < today) {
      errors.checkIn = 'Check-in cannot be in the past.'
    }
    if (!isValidDate(checkOut)) errors.checkOut = 'Enter a valid check-out date.'
    if (!errors.checkIn && !errors.checkOut && checkOut <= checkIn) {
      errors.checkOut = 'Check-out must be after check-in.'
    }

    if (!email || !isValidEmail(email)) errors.email = 'Enter a valid email address.'

    const guestCount = Number(guests)
    if (!guests || guestCount < 1) errors.guests = 'Enter at least 1 guest.'

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: errors })
    }

    const { rows: listingRows } = await pool.query(
      'select title, city, price_per_night, max_guests from listings where id = $1',
      [listingId],
    )
    if (listingRows.length === 0) {
      return res.status(404).json({ error: 'Listing not found' })
    }
    if (guestCount > listingRows[0].max_guests) {
      return res.status(400).json({
        error: 'Validation failed',
        fields: { guests: `This apartment sleeps up to ${listingRows[0].max_guests} guests.` },
      })
    }

    const listing = listingRows[0]
    const nights = nightsBetween(checkIn, checkOut)
    const totalAmount = nights * listing.price_per_night

    const { rows } = await pool.query(
      `insert into bookings (
        listing_id, full_name, email, phone, check_in, check_out, guests, notes,
        rate_per_night, total_amount, source_channel
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning id, booking_code, status`,
      [
        listingId, fullName, email, phone, checkIn, checkOut, guestCount, notes || null,
        listing.price_per_night, totalAmount, 'Website',
      ],
    )
    const statusUrl = `${FRONTEND_URL}/booking-status?code=${encodeURIComponent(rows[0].booking_code)}`

    sendCustomerEmail({
      to: email,
      name: fullName,
      subject: `We've received your booking request for ${listing.title}`,
      html: bookingGuestConfirmationEmail({
        fullName,
        listingTitle: listing.title,
        checkIn,
        checkOut,
        guests: guestCount,
        pricePerNight: formatNaira(listing.price_per_night),
        nights,
        bookingCode: rows[0].booking_code,
        statusUrl,
      }),
    })

    sendNotificationEmail({
      subject: `New booking request: ${listing.title}`,
      html: bookingAdminNotificationEmail({
        listingTitle: listing.title,
        listingCity: listing.city,
        checkIn,
        checkOut,
        guests: guestCount,
        fullName,
        email,
        phone,
        notes,
        bookingCode: rows[0].booking_code,
        dashboardUrl: ADMIN_DASHBOARD_URL,
      }),
    })

    res.status(201).json({ id: rows[0].id, bookingCode: rows[0].booking_code, status: rows[0].status })
  } catch (err) {
    // 23P01 = the bookings_no_overlap exclusion constraint rejected this
    // insert because another booking (possibly created a moment ago by a
    // concurrent request) already holds this unit for an overlapping date
    // range. The database is the source of truth here, not a race-prone
    // application-level availability check.
    if (err.code === '23P01') {
      return res.status(409).json({
        error: 'Those dates were just booked for this apartment. Please choose different dates.',
      })
    }
    next(err)
  }
})

// Public status lookup by the human-readable booking code (not the
// internal uuid) — this is what guests actually have on hand from their
// confirmation email/SMS. Rate-limited and format-checked specifically
// because, unlike the uuid, this code is short and partially predictable,
// so it needs its own guard against someone walking through codes to see
// other guests' stay dates/status.
router.get('/code/:code', bookingLookupLimiter, async (req, res, next) => {
  try {
    const code = String(req.params.code || '').trim().toUpperCase()
    if (!BOOKING_CODE_PATTERN.test(code)) {
      return res.status(404).json({ error: 'No booking found with that code.' })
    }

    const { rows } = await pool.query(
      `select b.booking_code, b.status, b.check_in, b.check_out, b.guests,
              b.actual_check_in_at, b.actual_check_out_at,
              l.title as listing_title, l.city as listing_city
       from bookings b
       join listings l on l.id = b.listing_id
       where b.booking_code = $1`,
      [code],
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No booking found with that code.' })
    }

    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

export default router
