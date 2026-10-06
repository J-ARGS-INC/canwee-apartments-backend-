// Scheduler only. Render's free tier sleeps, so a timer inside the API can't
// be relied on to fire. This Worker wakes the API with a health check, then
// calls the matching job. The job itself stays on Render, next to the data.
const JOB_BY_CRON = {
  '0 11 * * *': 'daily',
  '0 21 * * *': 'daily',
  '0 21 * * 6': 'weekly',
  '0 7 1 * *': 'monthly',
  '5 23 * * *': 'auto-status',
}

const WAKE_ATTEMPTS = 4
const WAKE_GAP_MS = 15000

async function wakeApi(apiUrl) {
  for (let attempt = 1; attempt <= WAKE_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(60000) })
      if (res.ok) return true
    } catch {
      // Still waking (Render cold starts can take close to a minute). Retry.
    }
    await new Promise((resolve) => setTimeout(resolve, WAKE_GAP_MS))
  }
  return false
}

async function runJob(job, env) {
  const awake = await wakeApi(env.API_URL)
  if (!awake) {
    console.error(`[canwee-cron] API did not wake for "${job}"`)
    return
  }
  const res = await fetch(`${env.API_URL}/api/cron/${job}`, {
    method: 'POST',
    headers: { 'x-cron-secret': env.CRON_SECRET },
    signal: AbortSignal.timeout(120000),
  })
  const body = await res.text()
  console.log(`[canwee-cron] ${job}: ${res.status} ${body}`)
}

export default {
  async scheduled(event, env, ctx) {
    const job = JOB_BY_CRON[event.cron]
    if (!job) {
      console.error(`[canwee-cron] no job for schedule "${event.cron}"`)
      return
    }
    ctx.waitUntil(runJob(job, env))
  },

  // No public endpoint: jobs can only be triggered by the schedule.
  async fetch() {
    return new Response('Not found', { status: 404 })
  },
}
