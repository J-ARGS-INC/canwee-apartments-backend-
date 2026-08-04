import { Router } from 'express'
import { pool } from '../db.js'
import { isValidEmail, requireString } from '../lib/validate.js'

const router = Router()

router.post('/', async (req, res, next) => {
  try {
    const { listingId, fullName, email, phone, checkIn, checkOut, guests, notes } = req.body ?? {}

    const errors = {}
    requireString(listingId, 'listingId', errors)
    requireString(fullName, 'fullName', errors)
    requireString(phone, 'phone', errors)
    requireString(checkIn, 'checkIn', errors)
    requireString(checkOut, 'checkOut', errors)

    if (!email || !isValidEmail(email)) errors.email = 'Enter a valid email address.'
    if (checkIn && checkOut && checkOut <= checkIn) errors.checkOut = 'Check-out must be after check-in.'

    const guestCount = Number(guests)
    if (!guests || guestCount < 1) errors.guests = 'Enter at least 1 guest.'

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: errors })
    }

    const { rows: listingRows } = await pool.query('select max_guests from listings where id = $1', [listingId])
    if (listingRows.length === 0) {
      return res.status(404).json({ error: 'Listing not found' })
    }
    if (guestCount > listingRows[0].max_guests) {
      return res.status(400).json({
        error: 'Validation failed',
        fields: { guests: `This apartment sleeps up to ${listingRows[0].max_guests} guests.` },
      })
    }

    const { rows } = await pool.query(
      `insert into bookings (listing_id, full_name, email, phone, check_in, check_out, guests, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id, status`,
      [listingId, fullName, email, phone, checkIn, checkOut, guestCount, notes || null],
    )

    res.status(201).json({ id: rows[0].id, status: rows[0].status })
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const { rows } = await pool.query(
      `select b.id, b.status, b.check_in, b.check_out, b.guests,
              b.actual_check_in_at, b.actual_check_out_at,
              l.title as listing_title, l.city as listing_city
       from bookings b
       join listings l on l.id = b.listing_id
       where b.id = $1`,
      [id],
    )

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No booking found with that ID.' })
    }

    res.json(rows[0])
  } catch (err) {
    if (err.code === '22P02') {
      return res.status(404).json({ error: 'No booking found with that ID.' })
    }
    next(err)
  }
})

export default router
