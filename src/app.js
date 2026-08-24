import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import listingsRouter from './routes/listings.js'
import bookingsRouter from './routes/bookings.js'
import contactRouter from './routes/contact.js'
import contentRouter from './routes/content.js'
import adminRouter from './routes/admin.js'
import adminExpensesRouter from './routes/adminExpenses.js'
import adminReportsRouter from './routes/adminReports.js'
import adminUsersRouter from './routes/adminUsers.js'
import adminPaymentsRouter from './routes/adminPayments.js'
import adminAgentsRouter from './routes/adminAgents.js'
import adminGuestsRouter from './routes/adminGuests.js'
import adminSettingsRouter from './routes/adminSettings.js'
import imagesRouter from './routes/images.js'
import videosRouter from './routes/videos.js'
import analyticsRouter from './routes/analytics.js'
import { apiLimiter } from './middleware/rateLimiters.js'

const DEFAULT_ORIGINS = 'http://localhost:5173,https://canweeapartments.com,https://www.canweeapartments.com'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)

  // Frontend and backend are on different origins (canweeapartments.com vs
  // the Render API), and listing photos are loaded cross-origin via <img>
  // tags — helmet's default Cross-Origin-Resource-Policy: same-origin would
  // silently block those, so it's relaxed here specifically.
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }))

  const allowedOrigins = (process.env.CORS_ORIGIN || DEFAULT_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  app.use(cors({ origin: allowedOrigins }))
  // Explicit rather than relying on express's default — every real payload
  // this API accepts (booking/contact/admin forms) is a few KB at most, so
  // 100kb is already generous while still bounding a giant-body DoS attempt.
  app.use(express.json({ limit: '100kb' }))
  app.use('/api', apiLimiter)

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  app.use('/api/listings', listingsRouter)
  app.use('/api/bookings', bookingsRouter)
  app.use('/api/contact', contactRouter)
  app.use('/api', contentRouter)
  app.use('/api', imagesRouter)
  app.use('/api', videosRouter)
  app.use('/api/admin', adminRouter)
  app.use('/api/admin/expenses', adminExpensesRouter)
  app.use('/api/admin', adminReportsRouter)
  app.use('/api/admin/users', adminUsersRouter)
  app.use('/api/admin', adminPaymentsRouter)
  app.use('/api/admin', adminAgentsRouter)
  app.use('/api/admin', adminGuestsRouter)
  app.use('/api/admin/settings', adminSettingsRouter)
  app.use('/api/analytics', analyticsRouter)

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  app.use((err, req, res, next) => {
    console.error(err)
    const status = err.status || 500
    // Only deliberately-thrown 4xx errors (with a safe, hand-written
    // message) are echoed back. Anything else — a raw Postgres error, an
    // unexpected exception — could leak internal details (schema names,
    // query fragments, stack info), so those always get a generic message.
    const message = status < 500 && err.message ? err.message : 'Internal server error'
    res.status(status).json({ error: message })
  })

  return app
}