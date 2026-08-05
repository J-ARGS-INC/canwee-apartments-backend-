import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { pool } from '../db.js'
import { requireAdmin } from '../middleware/adminAuth.js'
import { adminLimiter, loginLimiter } from '../middleware/rateLimiters.js'
import { isValidDate, isValidEmail, maxLength, requireString } from '../lib/validate.js'
import { diffFields, logAudit } from '../lib/auditLog.js'

// Precomputed so a login attempt for a username that doesn't exist still
// spends real time in bcrypt.compare — otherwise "unknown username" would
// respond measurably faster than "wrong password," letting an attacker
// enumerate valid usernames by timing alone.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 12)

const MONEY_FIELDS = ['ratePerNight', 'discount', 'totalAmount', 'amountPaid']
// Creating a booking/expense needs no justification — an edit changing
// values someone already recorded does, so the person making the change is
// forced to leave a paper trail explaining why (a correction, a guest
// dispute, a data-entry fix, etc), not just what changed.
function requireReason(body, errors) {
  if (typeof body.reason !== 'string' || !body.reason.trim()) {
    errors.reason = 'Enter a reason for the edit.'
  }
}

// Hard backstop against obviously-fraudulent values (negative amounts,
// non-numeric input) before they ever reach the DB — the DB-level CHECK
// constraints in schema.sql back this up in case this validation is ever
// bypassed or has a bug, but returning a clean 400 here is much better UX
// than surfacing a raw constraint-violation error.
function validateMoneyFields(body, errors) {
  for (const field of MONEY_FIELDS) {
    if (body[field] == null || body[field] === '') continue
    const num = Number(body[field])
    if (!Number.isFinite(num) || num < 0) {
      errors[field] = `${field} must be a non-negative number.`
    }
  }
}

const router = Router()

const TRANSITIONS = {
  confirm: { from: ['pending'], to: 'confirmed' },
  'check-in': { from: ['confirmed', 'pending'], to: 'checked_in' },
  'check-out': { from: ['checked_in'], to: 'checked_out' },
  cancel: { from: ['pending', 'confirmed'], to: 'cancelled' },
}

const BOOKING_SELECT = `
  select b.id, b.booking_code, b.booking_date, b.listing_id, b.full_name, b.email, b.phone,
         b.check_in, b.check_out, b.guests, b.notes, b.status,
         b.rate_per_night, b.discount, b.total_amount, b.amount_paid, b.balance,
         b.payment_status, b.payment_method, b.payment_date, b.source_channel, b.received_by,
         b.actual_check_in_at, b.actual_check_out_at, b.created_at, b.updated_at,
         l.title as listing_title, l.city as listing_city, l.unit_code, l.bedrooms
  from bookings b
  join listings l on l.id = b.listing_id
`

// Whitelisted camelCase -> column name so PATCH bodies can never target an
// arbitrary column, only these explicitly-supported financial/booking-
// management fields.
const FINANCE_FIELDS = {
  bookingDate: 'booking_date',
  ratePerNight: 'rate_per_night',
  discount: 'discount',
  totalAmount: 'total_amount',
  amountPaid: 'amount_paid',
  paymentStatus: 'payment_status',
  paymentMethod: 'payment_method',
  paymentDate: 'payment_date',
  sourceChannel: 'source_channel',
  receivedBy: 'received_by',
  notes: 'notes',
  fullName: 'full_name',
  phone: 'phone',
  email: 'email',
}

// Must be registered before the requireAdmin gate below — there's no
// token to present yet at the point of logging in.
router.post('/login', loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body ?? {}
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return res.status(400).json({ error: 'Enter your username and password.' })
    }

    const { rows } = await pool.query(
      'select id, display_name, role, is_active, password_hash from admin_users where id = $1',
      [username],
    )
    const record = rows[0]
    const valid = await bcrypt.compare(password, record ? record.password_hash : DUMMY_HASH)

    // A deactivated account fails login even with the correct password —
    // removal must be immediate and total, not just "can't do anything once
    // signed in."
    if (!record || !valid || !record.is_active) {
      return res.status(401).json({ error: 'Invalid username or password.' })
    }

    const token = jwt.sign({ sub: record.id }, process.env.JWT_SECRET, { expiresIn: '12h', algorithm: 'HS256' })
    res.json({ token, adminId: record.id, displayName: record.display_name, role: record.role })
  } catch (err) {
    next(err)
  }
})

router.use(requireAdmin)
router.use(adminLimiter)

router.get('/verify', (req, res) => {
  res.json({ ok: true, adminId: req.adminId, displayName: req.adminDisplayName, role: req.adminRole })
})

router.get('/bookings', async (req, res, next) => {
  try {
    const { status } = req.query
    const params = []
    let where = ''
    if (status && typeof status === 'string') {
      params.push(status)
      where = 'where b.status = $1'
    }

    // Paginated so the list stays fast and manageable as bookings pile up
    // over time — newest first, older ones only loaded on request (the
    // "Load more" button in BookingsTab) rather than all at once. The
    // Excel export uses its own unpaginated query in adminReports.js, so
    // it's unaffected and always includes the full history.
    const limitNum = Math.min(200, Math.max(1, Number(req.query.limit) || 25))
    const offsetNum = Math.max(0, Number(req.query.offset) || 0)

    const { rows: countRows } = await pool.query(`select count(*) from bookings b ${where}`, params)
    const total = Number(countRows[0].count)

    const { rows } = await pool.query(
      `${BOOKING_SELECT} ${where} order by b.check_in desc limit $${params.length + 1} offset $${params.length + 2}`,
      [...params, limitNum, offsetNum],
    )

    res.json({ bookings: rows, total })
  } catch (err) {
    next(err)
  }
})

// Manual entry for offline bookings (WhatsApp, Instagram, phone, walk-in,
// or backfilling historical records from the spreadsheet). Unlike the
// public POST /api/bookings, this skips guest-facing validation/emails —
// staff enter exactly what they know, including a status other than
// "pending" (e.g. straight to "checked_out" for a past stay).
router.post('/bookings', async (req, res, next) => {
  try {
    const {
      listingId, fullName, email, phone, checkIn, checkOut, guests, notes,
      status, bookingDate, ratePerNight, discount, totalAmount, amountPaid,
      paymentStatus, paymentMethod, paymentDate, sourceChannel, receivedBy,
    } = req.body ?? {}

    const errors = {}
    requireString(listingId, 'listingId', errors)
    requireString(fullName, 'fullName', errors)
    requireString(phone, 'phone', errors)
    maxLength(fullName, 'fullName', 200, errors)
    maxLength(phone, 'phone', 30, errors)
    maxLength(email, 'email', 200, errors)
    maxLength(notes, 'notes', 2000, errors)
    // Past check-in dates are allowed here (unlike the public form) —
    // backfilling real historical bookings from the operator's spreadsheet
    // is a legitimate, expected use of this endpoint.
    if (!isValidDate(checkIn)) errors.checkIn = 'Enter a valid check-in date.'
    if (!isValidDate(checkOut)) errors.checkOut = 'Enter a valid check-out date.'
    if (!errors.checkIn && !errors.checkOut && checkOut <= checkIn) {
      errors.checkOut = 'Check-out must be after check-in.'
    }
    if (email && !isValidEmail(email)) errors.email = 'Enter a valid email address.'
    validateMoneyFields(req.body ?? {}, errors)
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: errors })
    }

    const { rows: listingRows } = await pool.query('select price_per_night from listings where id = $1', [listingId])
    if (listingRows.length === 0) {
      return res.status(404).json({ error: 'Listing not found' })
    }

    const guestCount = Number(guests) || 1
    const rate = ratePerNight != null ? Number(ratePerNight) : listingRows[0].price_per_night
    const nights = Math.max(0, Math.round((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)))
    const discountAmount = discount != null ? Number(discount) : 0
    const total = totalAmount != null ? Number(totalAmount) : nights * rate - discountAmount

    const { rows } = await pool.query(
      `insert into bookings (
        listing_id, full_name, email, phone, check_in, check_out, guests, notes, status,
        booking_date, rate_per_night, discount, total_amount, amount_paid,
        payment_status, payment_method, payment_date, source_channel, received_by
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
      returning id, booking_code, status`,
      [
        listingId, fullName, email || null, phone, checkIn, checkOut, guestCount, notes || null,
        status || 'pending', bookingDate || new Date().toISOString().slice(0, 10), rate,
        discountAmount, total, amountPaid != null ? Number(amountPaid) : 0,
        paymentStatus || 'unpaid', paymentMethod || null, paymentDate || null,
        sourceChannel || null, receivedBy || null,
      ],
    )

    logAudit({
      entityType: 'booking',
      entityId: rows[0].id,
      action: 'create',
      changes: { listingId, fullName, checkIn, checkOut, rate, discount: discountAmount, total, status: status || 'pending' },
      actor: req.adminId,
    })

    res.status(201).json(rows[0])
  } catch (err) {
    // See the matching handler in routes/bookings.js — the database's
    // exclusion constraint, not application logic, is what actually
    // prevents two overlapping bookings for the same unit from both
    // committing, including a guest and an admin racing each other.
    if (err.code === '23P01') {
      return res.status(409).json({
        error: 'This unit is already booked for an overlapping date range.',
      })
    }
    next(err)
  }
})

// Booking-management fields (payments, dates, contact details) — separate
// from the /bookings/:id status-transition endpoint below, since these are
// edits, not a workflow transition with from/to rules.
router.patch('/bookings/:id/details', async (req, res, next) => {
  try {
    const { id } = req.params
    const body = req.body ?? {}

    const errors = {}
    requireReason(body, errors)
    validateMoneyFields(body, errors)
    if ('email' in body && body.email && !isValidEmail(body.email)) {
      errors.email = 'Enter a valid email address.'
    }
    if ('fullName' in body && (typeof body.fullName !== 'string' || !body.fullName.trim())) {
      errors.fullName = 'Guest name cannot be blank.'
    }
    if ('phone' in body && (typeof body.phone !== 'string' || !body.phone.trim())) {
      errors.phone = 'Phone cannot be blank.'
    }
    maxLength(body.fullName, 'fullName', 200, errors)
    maxLength(body.phone, 'phone', 30, errors)
    maxLength(body.email, 'email', 200, errors)
    maxLength(body.notes, 'notes', 2000, errors)
    maxLength(body.reason, 'reason', 1000, errors)
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: errors })
    }

    const setClauses = []
    const params = []
    for (const [key, column] of Object.entries(FINANCE_FIELDS)) {
      if (key in body) {
        params.push(body[key])
        setClauses.push(`${column} = $${params.length}`)
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No recognized fields to update.' })
    }

    const { rows: before } = await pool.query(`${BOOKING_SELECT} where b.id = $1`, [id])
    if (before.length === 0) {
      return res.status(404).json({ error: 'Booking not found' })
    }

    // Optimistic concurrency: the client sends back the `updated_at` it
    // last saw (set when the edit form was opened). If someone else saved a
    // change to this booking in the meantime, that value has moved on and
    // this WHERE clause matches zero rows instead of silently overwriting
    // their edit — the alternative (updating unconditionally by id alone)
    // is a classic lost-update bug: two admins editing the same booking at
    // once, second save wins, first admin's change vanishes with no error.
    let versionClause = ''
    if (typeof body.expectedUpdatedAt === 'string' && body.expectedUpdatedAt) {
      params.push(body.expectedUpdatedAt)
      versionClause = ` and updated_at = $${params.length}`
    }

    params.push(id)
    const { rows } = await pool.query(
      `update bookings set ${setClauses.join(', ')}, updated_at = now()
       where id = $${params.length}${versionClause}
       returning id`,
      params,
    )

    if (rows.length === 0) {
      return res.status(409).json({
        error: 'This booking was changed by someone else since you opened it. Reload and try again.',
      })
    }

    const { rows: full } = await pool.query(`${BOOKING_SELECT} where b.id = $1`, [id])

    const changedKeys = Object.keys(body).filter((key) => key in FINANCE_FIELDS)
    const beforeCamel = {}
    const afterCamel = {}
    for (const key of changedKeys) {
      const column = FINANCE_FIELDS[key]
      beforeCamel[key] = before[0][column]
      afterCamel[key] = full[0][column]
    }
    logAudit({
      entityType: 'booking',
      entityId: id,
      action: 'update',
      changes: diffFields(beforeCamel, afterCamel, changedKeys),
      actor: req.adminId,
      reason: body.reason,
    })

    res.json(full[0])
  } catch (err) {
    next(err)
  }
})

router.patch('/bookings/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const { action } = req.body ?? {}

    const transition = TRANSITIONS[action]
    if (!transition) {
      return res.status(400).json({ error: `Unknown action "${action}".` })
    }

    const timestampColumn =
      transition.to === 'checked_in'
        ? 'actual_check_in_at'
        : transition.to === 'checked_out'
          ? 'actual_check_out_at'
          : null

    // A separate "read the status, check it in JS, then update" has a race
    // window between the read and the write: two admins both hitting
    // check-in/cancel/etc on the same booking at nearly the same instant can
    // both read the same starting status, both pass their own from-check,
    // and both update — the second write silently overwrites the first with
    // no error, even though it logs an audit entry claiming its transition
    // succeeded. `select ... for update` inside a transaction closes that
    // window: it takes a row lock, so a second concurrent request's own
    // `for update` blocks until the first transaction commits, then sees
    // the already-updated status — its from-check then correctly fails
    // against the new state instead of the stale one it would have read
    // without the lock.
    const client = await pool.connect()
    let result
    try {
      await client.query('BEGIN')
      const { rows: locked } = await client.query('select status from bookings where id = $1 for update', [id])

      if (locked.length === 0) {
        await client.query('ROLLBACK')
        result = { status: 404, body: { error: 'Booking not found' } }
      } else if (!transition.from.includes(locked[0].status)) {
        await client.query('ROLLBACK')
        result = {
          status: 409,
          body: {
            error: `Cannot ${action.replace('-', ' ')} a booking that is currently "${locked[0].status}". Someone may have just updated it.`,
          },
        }
      } else {
        const previousStatus = locked[0].status
        const { rows: updated } = await client.query(
          `update bookings
           set status = $1, updated_at = now()${timestampColumn ? `, ${timestampColumn} = now()` : ''}
           where id = $2
           returning id, status, actual_check_in_at, actual_check_out_at, updated_at`,
          [transition.to, id],
        )
        await client.query('COMMIT')

        logAudit({
          entityType: 'booking',
          entityId: id,
          action: 'status_change',
          changes: { status: { old: previousStatus, new: transition.to } },
          actor: req.adminId,
        })

        result = { status: 200, body: updated[0] }
      }
    } catch (err) {
      await client.query('ROLLBACK')
      throw err
    } finally {
      client.release()
    }

    res.status(result.status).json(result.body)
  } catch (err) {
    next(err)
  }
})

export default router
