import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

// Unlike /api/images/:id, this must honor Range requests: Safari refuses
// to play a <video> at all without a 206 response to its first probe
// request, and scrubbing/seeking in every browser relies on subsequent
// range requests rather than redownloading the whole file. The bytea is
// still loaded into memory in full per request (fine at this scale — a
// handful of short clips, low traffic) rather than streamed from Postgres
// in chunks, matching the simple-storage tradeoff already made for images.
router.get('/videos/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query(
      'select content_type, data from listing_videos where id = $1',
      [req.params.id],
    )
    if (rows.length === 0) return res.status(404).json({ error: 'Video not found' })

    const { content_type: contentType, data } = rows[0]
    const size = data.length

    res.setHeader('Accept-Ranges', 'bytes')
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable')

    const range = req.headers.range
    if (!range) {
      res.setHeader('Content-Type', contentType)
      res.setHeader('Content-Length', size)
      return res.send(data)
    }

    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match || (!match[1] && !match[2])) {
      res.setHeader('Content-Range', `bytes */${size}`)
      return res.status(416).end()
    }

    const start = match[1] ? parseInt(match[1], 10) : size - parseInt(match[2], 10)
    const end = match[1] && match[2] ? Math.min(parseInt(match[2], 10), size - 1) : size - 1

    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start < 0 || end >= size) {
      res.setHeader('Content-Range', `bytes */${size}`)
      return res.status(416).end()
    }

    res.status(206)
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`)
    res.setHeader('Content-Length', end - start + 1)
    res.setHeader('Content-Type', contentType)
    res.send(data.subarray(start, end + 1))
  } catch (err) {
    if (err.code === '22P02') return res.status(404).json({ error: 'Video not found' })
    next(err)
  }
})

export default router
