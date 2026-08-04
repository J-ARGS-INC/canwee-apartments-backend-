import { Router } from 'express'
import { pool } from '../db.js'
import { isValidEmail, requireString } from '../lib/validate.js'

const router = Router()

router.post('/', async (req, res, next) => {
  try {
    const { name, email, topic, message } = req.body ?? {}

    const errors = {}
    requireString(name, 'name', errors)
    requireString(topic, 'topic', errors)
    if (!email || !isValidEmail(email)) errors.email = 'Enter a valid email address.'
    if (!message || !message.trim()) {
      errors.message = 'Tell us a bit about what you need.'
    } else if (message.trim().length < 10) {
      errors.message = 'A few more details would help (10+ characters).'
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: errors })
    }

    const { rows } = await pool.query(
      'insert into contact_messages (name, email, topic, message) values ($1,$2,$3,$4) returning id',
      [name, email, topic, message],
    )

    res.status(201).json({ id: rows[0].id })
  } catch (err) {
    next(err)
  }
})

export default router
