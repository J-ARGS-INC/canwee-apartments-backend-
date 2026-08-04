import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

router.get('/images/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'select content_type, data from listing_images where id = $1',
      [req.params.id],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Image not found' })

    res.setHeader('Content-Type', rows[0].content_type)
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')
    res.send(rows[0].data)
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Image not found' })
    next(err)
  }
})

export default router
