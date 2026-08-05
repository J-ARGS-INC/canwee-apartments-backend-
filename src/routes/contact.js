import { Router } from 'express'
import { pool } from '../db.js'
import { isValidEmail, maxLength, requireString } from '../lib/validate.js'
import { sendNotificationEmail } from '../lib/notify.js'
import { contactAdminNotificationEmail } from '../lib/emailTemplates.js'
import { createSubmissionLimiter } from '../middleware/rateLimiters.js'
import { idempotent } from '../middleware/idempotency.js'

const router = Router()

router.post('/', createSubmissionLimiter(), idempotent(), async (req, res, next) => {
  try {
    const { name, email, topic, message } = req.body ?? {}

    const errors = {}
    requireString(name, 'name', errors)
    requireString(topic, 'topic', errors)
    maxLength(name, 'name', 200, errors)
    maxLength(topic, 'topic', 100, errors)
    maxLength(email, 'email', 200, errors)
    if (!email || !isValidEmail(email)) errors.email = 'Enter a valid email address.'
    if (!message || !message.trim()) {
      errors.message = 'Tell us a bit about what you need.'
    } else if (message.trim().length < 10) {
      errors.message = 'A few more details would help (10+ characters).'
    } else {
      maxLength(message, 'message', 5000, errors)
    }

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: errors })
    }

    const { rows } = await pool.query(
      'insert into contact_messages (name, email, topic, message) values ($1,$2,$3,$4) returning id',
      [name, email, topic, message],
    )

    sendNotificationEmail({
      subject: `New contact message: ${topic}`,
      html: contactAdminNotificationEmail({
        name,
        email,
        topic,
        message,
        receivedAt: new Date().toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }),
      }),
    })

    res.status(201).json({ id: rows[0].id })
  } catch (err) {
    next(err)
  }
})

export default router
