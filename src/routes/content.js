import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

router.get('/testimonials', async (req, res, next) => {
  try {
    const { rows } = await pool.query('select id, name, location, quote, rating from testimonials order by id')
    res.json(rows.map((row) => ({ ...row, rating: Number(row.rating) })))
  } catch (err) {
    next(err)
  }
})

router.get('/faqs', async (req, res, next) => {
  try {
    const { rows } = await pool.query('select question, answer from faqs order by sort_order')
    res.json(rows)
  } catch (err) {
    next(err)
  }
})

export default router
