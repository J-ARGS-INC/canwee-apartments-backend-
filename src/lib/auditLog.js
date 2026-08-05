import { pool } from '../db.js'

// Never throws — a failed audit write should never block the actual
// operation it's recording. `actor` is self-reported (there's no
// per-staff login yet, just one shared admin key), so this proves what
// changed and when, not cryptographically who did it.
export async function logAudit({ entityType, entityId, action, changes, actor, reason }) {
  try {
    await pool.query(
      'insert into audit_log (entity_type, entity_id, action, changes, actor, reason) values ($1,$2,$3,$4,$5,$6)',
      [entityType, entityId, action, changes ? JSON.stringify(changes) : null, actor || null, reason || null],
    )
  } catch (err) {
    console.error('Failed to write audit log:', err)
  }
}

export function diffFields(before, after, keys) {
  const changes = {}
  for (const key of keys) {
    const oldValue = before[key]
    const newValue = after[key]
    if (String(oldValue ?? '') !== String(newValue ?? '')) {
      changes[key] = { old: oldValue, new: newValue }
    }
  }
  return changes
}
