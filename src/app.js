import express from 'express'
import cors from 'cors'
import listingsRouter from './routes/listings.js'
import bookingsRouter from './routes/bookings.js'
import contactRouter from './routes/contact.js'
import contentRouter from './routes/content.js'
import adminRouter from './routes/admin.js'
import imagesRouter from './routes/images.js'

const DEFAULT_ORIGINS = 'http://localhost:5173,https://canweeapartments.com,https://www.canweeapartments.com'

export function createApp() {
  const app = express()
  app.set('trust proxy', 1)

  const allowedOrigins = (process.env.CORS_ORIGIN || DEFAULT_ORIGINS)
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)

  app.use(cors({ origin: allowedOrigins }))
  app.use(express.json())

  app.get('/api/health', (req, res) => res.json({ ok: true }))

  app.use('/api/listings', listingsRouter)
  app.use('/api/bookings', bookingsRouter)
  app.use('/api/contact', contactRouter)
  app.use('/api', contentRouter)
  app.use('/api', imagesRouter)
  app.use('/api/admin', adminRouter)

  app.use((req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  app.use((err, req, res, next) => {
    console.error(err)
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' })
  })

  return app
}
