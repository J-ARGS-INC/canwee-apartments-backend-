import { pool } from '../db.js'

// Every setting the admin UI (and other server code, e.g. notify.js) is
// allowed to read/write, with a default used until a super admin overrides
// it via PUT /admin/settings/:key. Keeping the whitelist here (not just in
// adminSettings.js) lets notify.js reuse the same defaults without
// duplicating them.
export const SETTING_DEFAULTS = {
  notify_emails: [],
  expense_categories: ['Utilities', 'Maintenance', 'Cleaning', 'Supplies', 'Staff', 'Marketing', 'Other'],
  payment_methods: ['Cash', 'Bank Transfer', 'POS', 'Card', 'Other'],
}

export async function getSetting(key) {
  const { rows } = await pool.query('select value from settings where key = $1', [key])
  if (rows.length === 0) return SETTING_DEFAULTS[key]
  return rows[0].value
}

export async function getAllSettings() {
  const { rows } = await pool.query('select key, value from settings')
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]))
  return { ...SETTING_DEFAULTS, ...stored }
}
