import pg from 'pg'

const { Pool } = pg

// Discrete PG* env vars (not a single connection URL) so a password with
// special characters never needs manual percent-encoding.
export const pool = new Pool({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT) || 5432,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
})

export function query(text, params) {
  return pool.query(text, params)
}
