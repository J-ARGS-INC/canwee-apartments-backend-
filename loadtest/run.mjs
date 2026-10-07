import autocannon from 'autocannon'

// Load-tests READ-ONLY endpoints only, by design. Hammering a write
// endpoint (POST /bookings, POST /payments, etc.) with concurrent
// connections would create real rows, send real notification emails, and
// pollute real guest/financial data — never point this at a write route
// against the live database. If a write-path load test is ever genuinely
// needed, it belongs on a separate staging database, not here.
//
// Target defaults to localhost so running this never accidentally hits
// the live production server. Pass a different URL explicitly if you
// really mean to (e.g. LOADTEST_URL=https://canwee-apartments-api.onrender.com
// npm run loadtest) — expect real-world latency/variance from Render's
// network and, if the service was asleep, the first requests paying a
// cold-start cost.
const url = process.env.LOADTEST_URL || 'http://localhost:4000'
const duration = Number(process.env.LOADTEST_DURATION) || 10 // seconds
const connections = Number(process.env.LOADTEST_CONNECTIONS) || 10

const targets = [
  { title: 'Health check', path: '/api/health' },
  { title: 'Public listings', path: '/api/listings' },
]

for (const target of targets) {
  console.log(`\n=== ${target.title}: ${connections} connections for ${duration}s against ${url}${target.path} ===`)
  const result = await autocannon({
    url: `${url}${target.path}`,
    connections,
    duration,
  })
  console.log(autocannon.printResult(result))
}
