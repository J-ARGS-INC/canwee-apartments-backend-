import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { pool } from '../src/db.js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8')

pool
  .query(sql)
  .then(() => {
    console.log('Schema applied.')
    return pool.end()
  })
  .catch((err) => {
    console.error('Migration failed:', err)
    process.exit(1)
  })
