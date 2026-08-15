import 'dotenv/config'
import { createApp } from './app.js'
import { startScheduledReports } from './cron.js'

const port = process.env.PORT || 4000
const app = createApp()

app.listen(port, () => {
  console.log(`Canwee API listening on port ${port}`)
  startScheduledReports()
})
