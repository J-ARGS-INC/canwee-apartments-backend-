import cron from 'node-cron'
import { sendDailyDigest, sendWeeklyDigest, sendMonthlyReport } from './lib/scheduledReports.js'

const TIMEZONE = 'Africa/Lagos'

// Each job is wrapped so a failure (e.g. a transient DB hiccup) is logged,
// not left to crash the whole process or silently kill future scheduled
// runs — node-cron keeps calling the same task on schedule regardless of
// whether the previous run threw.
function safeRun(name, task) {
  return async () => {
    try {
      await task()
      console.log(`[cron] ${name} sent successfully.`)
    } catch (err) {
      console.error(`[cron] ${name} failed:`, err)
    }
  }
}

export function startScheduledReports() {
  cron.schedule('0 12 * * *', safeRun('daily digest (noon)', sendDailyDigest), { timezone: TIMEZONE })
  cron.schedule('0 22 * * *', safeRun('daily digest (night)', sendDailyDigest), { timezone: TIMEZONE })
  cron.schedule('0 22 * * 6', safeRun('weekly digest', sendWeeklyDigest), { timezone: TIMEZONE })
  cron.schedule('0 8 1 * *', safeRun('monthly report', sendMonthlyReport), { timezone: TIMEZONE })
  console.log('[cron] Scheduled reports armed (daily 12pm & 10pm, weekly Sat 10pm, monthly 1st 8am, Africa/Lagos).')
}
