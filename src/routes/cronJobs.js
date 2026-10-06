import { Router } from 'express'
import crypto from 'node:crypto'
import { sendDailyDigest, sendWeeklyDigest, sendMonthlyReport } from '../lib/scheduledReports.js'
import { runAutoStatusTransitions } from '../lib/autoStatusTransitions.js'

// Triggered on schedule by the Cloudflare Worker (see cloudflare-cron/), not by
// an in-process timer — Render's free tier sleeps, and a sleeping process can't
// fire a timer. The request itself wakes the service, then the job runs.
const JOBS = {
  daily: sendDailyDigest,
  weekly: sendWeeklyDigest,
  monthly: sendMonthlyReport,
  'auto-status': runAutoStatusTransitions,
}

const router = Router()

function secretMatches(provided) {
  const expected = process.env.CRON_SECRET
  if (!expected || typeof provided !== 'string') return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

router.post('/:job', async (req, res, next) => {
  if (!secretMatches(req.get('x-cron-secret'))) {
    return res.status(401).json({ error: 'Invalid cron credentials.' })
  }
  const job = JOBS[req.params.job]
  if (!job) return res.status(400).json({ error: `Unknown job "${req.params.job}".` })
  try {
    await job()
    res.json({ ok: true, job: req.params.job })
  } catch (err) {
    next(err)
  }
})

export default router
