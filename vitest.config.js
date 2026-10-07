import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.js'],
    // DB-backed integration tests go over the network to the real Postgres
    // instance — slower than in-memory, needs real headroom.
    testTimeout: 20000,
    hookTimeout: 20000,
    // One worker: several suites share admin_users/bookings/expenses rows
    // via the same live database, and running them in parallel processes
    // risks one suite's cleanup racing another's setup.
    fileParallelism: false,
  },
})
