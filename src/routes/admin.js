import { Router } from 'express'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { pool } from '../db.js'
import { requireAdmin, requireSuperAdmin } from '../middleware/adminAuth.js'
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

// payment_status is a label an admin sets by hand, but amount_paid is what
// actually drives revenue reporting (adminReports.js sums amount_paid, not
// the label) — without this, an admin could switch a booking to "paid"
// without the paid amount actually matching the total, so the sale would
// show as paid in the list but not be reflected in collected revenue, or a
// stale amount_paid could get labelled "paid" long after a discount changed
// the total. This keeps the label and the number that's actually recorded
// in sync at the moment either one changes.
function validatePaymentConsistency({ paymentStatus, amountPaid, totalAmount }, errors) {
  if (!paymentStatus) return
  const paid = Number(amountPaid) || 0
  const total = totalAmount != null ? Number(totalAmount) : null

  if (paymentStatus === 'unpaid') {
    if (paid > 0) errors.paymentStatus = 'Amount paid must be 0 for an unpaid booking.'
    return
  }

  if (total == null) {
    errors.paymentStatus = `Set a total amount before marking this booking as ${paymentStatus.replace('_', ' ')}.`
    return
  }

  if (paymentStatus === 'part_payment' && !(paid > 0 && paid < total)) {
    errors.paymentStatus = 'Amount paid must be more than 0 and less than the total for a part payment.'
  } else if (paymentStatus === 'paid' && Math.abs(paid - total) > 0.01) {
    errors.paymentStatus = 'Amount paid must equal the total amount to mark this booking as paid.'
  } else if (paymentStatus === 'overpaid' && !(paid > total)) {
    errors.paymentStatus = 'Amount paid must be more than the total to mark this booking as overpaid.'
  }
}

const router = Router()

// A Map, not a plain object — `action` is client-supplied request input,
// and plain-object bracket lookup resolves inherited keys like
// "__proto__"/"constructor" to a truthy prototype-chain object instead of
// undefined, which would slip past the `!transition` guard below and then
// throw reading `.from` on it. A Map has no prototype chain to fall
// through, so an unrecognized action always misses cleanly. Same class of
// bug as the location filter fix elsewhere in this codebase.
const TRANSITIONS = new Map([
  ['confirm', { from: ['pending'], to: 'confirmed' }],
  ['check-in', { from: ['confirmed', 'pending'], to: 'checked_in' }],
  ['check-out', { from: ['checked_in'], to: 'checked_out' }],
  ['cancel', { from: ['pending', 'confirmed'], to: 'cancelled' }],
  ['no-show', { from: ['pending', 'confirmed'], to: 'no_show' }],
])

const BOOKING_SELECT = `
  select b.id, b.booking_code, b.booking_date, b.listing_id, b.full_name, b.email, b.phone,
         b.check_in, b.check_out, b.guests, b.notes, b.status,
         b.rate_per_night, b.discount, b.total_amount, b.amount_paid, b.balance,
         b.payment_status, b.payment_method, b.payment_date, b.source_channel, b.received_by,
         b.agent_id, ag.name as agent_name, ag.phone as agent_phone,
         b.actual_check_in_at, b.actual_check_out_at, b.created_at, b.updated_at,
         b.checkout_reason, b.checked_out_by, b.checkout_reviewed_by, b.checkout_reviewed_at,
         l.title as listing_title, l.city as listing_city, l.unit_code, l.bedrooms
  from bookings b
  join listings l on l.id = b.listing_id
  left join agents ag on ag.id = b.agent_id
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
  agentId: 'agent_id',
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
    const { status, paymentStatus, listingId, guestQuery, startDate, endDate } = req.query
    const params = []
    const conditions = []

    if (status && typeof status === 'string') {
      params.push(status)
      conditions.push(`b.status = $${params.length}`)
    }
    if (paymentStatus && typeof paymentStatus === 'string') {
      params.push(paymentStatus)
      conditions.push(`b.payment_status = $${params.length}`)
    }
    if (listingId && typeof listingId === 'string') {
      params.push(listingId)
      conditions.push(`b.listing_id = $${params.length}`)
    }
    // Matches guest name, phone, email, or booking code in one box — front
    // desk staff typically have just one of these on hand at a time.
    if (guestQuery && typeof guestQuery === 'string' && guestQuery.trim()) {
      params.push(`%${guestQuery.trim()}%`)
      conditions.push(
        `(b.full_name ilike $${params.length} or b.phone ilike $${params.length} or b.email ilike $${params.length} or b.booking_code ilike $${params.length})`,
      )
    }
    if (isValidDate(startDate)) {
      params.push(startDate)
      conditions.push(`b.check_in >= $${params.length}`)
    }
    if (isValidDate(endDate)) {
      params.push(endDate)
      conditions.push(`b.check_in <= $${params.length}`)
    }

    const where = conditions.length ? `where ${conditions.join(' and ')}` : ''

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

// Front-desk lookup: reception has a guest standing in front of them with
// only the booking code from their confirmation email, and needs to
// confirm this is genuinely the person who reserved the room before
// handing over keys/access. Unlike the public GET /api/bookings/code/:code
// (rate-limited, no PII, for a guest checking their own status), this is
// authenticated admin access and deliberately returns the full record —
// name, phone, email — so staff can actually verify identity, plus enough
// context (unit, dates, payment status) to decide whether check-in should
// proceed at all (e.g. an unpaid balance).
router.get('/bookings/lookup/:code', async (req, res, next) => {
  try {
    const { rows } = await pool.query(`${BOOKING_SELECT} where b.booking_code = $1`, [req.params.code.trim().toUpperCase()])
    if (rows.length === 0) return res.status(404).json({ error: 'No booking found with that code.' })
    res.json(rows[0])
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
      paymentStatus, paymentMethod, paymentDate, sourceChannel, receivedBy, agentId,
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

    if (agentId != null) {
      const { rows: agentRows } = await pool.query('select id from agents where id = $1', [agentId])
      if (agentRows.length === 0) {
        return res.status(404).json({ error: 'Agent not found' })
      }
    }

    const guestCount = Number(guests) || 1
    const rate = ratePerNight != null ? Number(ratePerNight) : listingRows[0].price_per_night
    const nights = Math.max(0, Math.round((new Date(checkOut) - new Date(checkIn)) / (1000 * 60 * 60 * 24)))
    const discountAmount = discount != null ? Number(discount) : 0
    const total = totalAmount != null ? Number(totalAmount) : nights * rate - discountAmount
    const paidAmount = amountPaid != null ? Number(amountPaid) : 0
    const paymentStatusValue = paymentStatus || 'unpaid'
    // A sensible default for staff who pick an agent but leave the channel
    // blank, without ever overwriting a channel they did specify — an agent
    // can still reach out over WhatsApp, so the two aren't always the same.
    const sourceChannelValue = sourceChannel || (agentId ? 'Agent' : null)

    const paymentErrors = {}
    validatePaymentConsistency({ paymentStatus: paymentStatusValue, amountPaid: paidAmount, totalAmount: total }, paymentErrors)
    if (Object.keys(paymentErrors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: paymentErrors })
    }

    const { rows } = await pool.query(
      `insert into bookings (
        listing_id, full_name, email, phone, check_in, check_out, guests, notes, status,
        booking_date, rate_per_night, discount, total_amount, amount_paid,
        payment_status, payment_method, payment_date, source_channel, received_by, agent_id
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
      returning id, booking_code, status`,
      [
        listingId, fullName, email || null, phone, checkIn, checkOut, guestCount, notes || null,
        status || 'pending', bookingDate || new Date().toISOString().slice(0, 10), rate,
        discountAmount, total, paidAmount,
        paymentStatusValue, paymentMethod || null, paymentDate || null,
        sourceChannelValue, receivedBy || null, agentId || null,
      ],
    )

    logAudit({
      entityType: 'booking',
      entityId: rows[0].id,
      action: 'create',
      changes: { listingId, fullName, checkIn, checkOut, rate, discount: discountAmount, total, status: status || 'pending', agentId: agentId || null },
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

    // Only re-check consistency when a payment-related field is actually
    // part of this edit — an unrelated edit (e.g. fixing a typo in the
    // guest's phone number) on an older booking that predates this check
    // shouldn't suddenly get blocked by a mismatch it didn't create.
    if ('paymentStatus' in body || 'amountPaid' in body || 'totalAmount' in body) {
      const effectivePaymentStatus = 'paymentStatus' in body ? body.paymentStatus : before[0].payment_status
      const effectiveAmountPaid = 'amountPaid' in body ? Number(body.amountPaid) : Number(before[0].amount_paid)
      const effectiveTotalAmount =
        'totalAmount' in body
          ? (body.totalAmount != null ? Number(body.totalAmount) : null)
          : (before[0].total_amount != null ? Number(before[0].total_amount) : null)

      const paymentErrors = {}
      validatePaymentConsistency(
        { paymentStatus: effectivePaymentStatus, amountPaid: effectiveAmountPaid, totalAmount: effectiveTotalAmount },
        paymentErrors,
      )
      if (Object.keys(paymentErrors).length > 0) {
        return res.status(400).json({ error: 'Validation failed', fields: paymentErrors })
      }
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

    // hasOwnProperty, not `in` — `in` also matches inherited keys like
    // "toString"/"constructor"/"__proto__", which a crafted body could send
    // as an own key to smuggle one into this (audit-log-only) diff.
    const changedKeys = Object.keys(body).filter((key) => Object.prototype.hasOwnProperty.call(FINANCE_FIELDS, key))
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
    const { action, reason } = req.body ?? {}

    const transition = typeof action === 'string' ? TRANSITIONS.get(action) : undefined
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
      const { rows: locked } = await client.query('select status, balance from bookings where id = $1 for update', [id])

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
        // A guest is physically leaving — the system doesn't get to block
        // that in real time — but checking out with money still owed needs
        // a reason on record and gets flagged for the super admin to review
        // (see GET/PATCH /admin/checkouts/owing). The real balance comes
        // from the row just locked, never a client-supplied value.
        const owesMoney = transition.to === 'checked_out' && Number(locked[0].balance) > 0
        if (owesMoney && (typeof reason !== 'string' || !reason.trim())) {
          await client.query('ROLLBACK')
          result = {
            status: 400,
            body: {
              error: 'This guest still owes a balance. Enter a reason for checking out without full payment.',
              fields: { reason: 'A reason is required to check out a guest with an outstanding balance.' },
            },
          }
        } else {
          const previousStatus = locked[0].status
          const { rows: updated } = await client.query(
            `update bookings
             set status = $1, updated_at = now()${timestampColumn ? `, ${timestampColumn} = now()` : ''}
                 ${owesMoney ? ', checkout_reason = $3, checked_out_by = $4' : ''}
             where id = $2
             returning id, status, actual_check_in_at, actual_check_out_at, updated_at,
                       checkout_reason, checked_out_by, checkout_reviewed_by, checkout_reviewed_at`,
            owesMoney ? [transition.to, id, reason.trim(), req.adminId] : [transition.to, id],
          )
          await client.query('COMMIT')

          logAudit({
            entityType: 'booking',
            entityId: id,
            action: 'status_change',
            changes: {
              status: { old: previousStatus, new: transition.to },
              ...(owesMoney ? { checkoutReason: { old: null, new: reason.trim() } } : {}),
            },
            actor: req.adminId,
            reason: owesMoney ? reason.trim() : undefined,
          })

          result = { status: 200, body: updated[0] }
        }
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

// Every guest who left owing money, oldest-unreviewed-first — the "debtors"
// list the super admin asked for, with who processed the checkout and why.
// Super-admin-only, matching every other financial oversight route.
router.get('/checkouts/owing', requireSuperAdmin, async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      `select b.id, b.booking_code, b.full_name, b.email, b.phone,
              b.check_in, b.check_out, b.total_amount, b.amount_paid, b.balance,
              b.checkout_reason, b.checked_out_by, b.checkout_reviewed_by, b.checkout_reviewed_at,
              b.actual_check_out_at,
              l.title as listing_title, l.city as listing_city, l.unit_code,
              cb.display_name as checked_out_by_name,
              rb.display_name as checkout_reviewed_by_name
       from bookings b
       join listings l on l.id = b.listing_id
       left join admin_users cb on cb.id = b.checked_out_by
       left join admin_users rb on rb.id = b.checkout_reviewed_by
       where b.status = 'checked_out' and b.balance > 0
       order by (b.checkout_reviewed_at is not null), b.actual_check_out_at desc`,
    )
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

router.patch('/bookings/:id/checkout-review', requireSuperAdmin, async (req, res, next) => {
  try {
    const { id } = req.params
    const { rows } = await pool.query(
      `update bookings
       set checkout_reviewed_by = $1, checkout_reviewed_at = now()
       where id = $2 and status = 'checked_out' and balance > 0
       returning id, checkout_reviewed_by, checkout_reviewed_at`,
      [req.adminId, id],
    )
    if (rows.length === 0) {
      return res.status(404).json({ error: 'No unpaid checkout found for this booking.' })
    }

    logAudit({
      entityType: 'booking',
      entityId: id,
      action: 'checkout_reviewed',
      changes: { checkoutReviewedBy: { old: null, new: req.adminId } },
      actor: req.adminId,
    })

    res.json(rows[0])
  } catch (err) {
    next(err)
  }
})

export default router
