import { Router } from 'express'
import { pool } from '../db.js'
import { requireAdmin } from '../middleware/adminAuth.js'
import { adminLimiter } from '../middleware/rateLimiters.js'
import { diffFields, logAudit } from '../lib/auditLog.js'
import { maxLength } from '../lib/validate.js'
import { idempotent } from '../middleware/idempotency.js'

const EXPENSE_FIELDS = {
  expenseDate: 'expense_date',
  category: 'category',
  description: 'description',
  amount: 'amount',
  listingId: 'listing_id',
  paidTo: 'paid_to',
  loggedBy: 'logged_by',
  notes: 'notes',
}

const router = Router()

router.use(requireAdmin)
router.use(adminLimiter)

router.get('/', async (req, res, next) => {
  try {
    // Paginated the same way as admin bookings — newest first, older
    // entries loaded on request via "Load more" instead of all at once.
    const limitNum = Math.min(200, Math.max(1, Number(req.query.limit) || 25))
    const offsetNum = Math.max(0, Number(req.query.offset) || 0)

    const { rows: countRows } = await pool.query(
      "select count(*), coalesce(sum(amount), 0) as total_amount from expenses where deleted_at is null",
    )
    const total = Number(countRows[0].count)
    const totalAmount = Number(countRows[0].total_amount)

    const { rows } = await pool.query(
      `select e.id, e.expense_date, e.category, e.description, e.amount, e.listing_id,
              e.paid_to, e.logged_by, e.notes, e.created_at, e.updated_at, l.title as listing_title
       from expenses e
       left join listings l on l.id = e.listing_id
       where e.deleted_at is null
       order by e.expense_date desc, e.created_at desc
       limit $1 offset $2`,
      [limitNum, offsetNum],
    )
    res.json({ expenses: rows, total, totalAmount })
  } catch (err) {
    next(err)
  }
})

// See adminPayments.js for why idempotent() matters specifically on a
// money-creating POST: a double-tap or retried request must replay the
// first response, not log the expense twice.
router.post('/', idempotent(), async (req, res, next) => {
  try {
    const { expenseDate, category, description, amount, listingId, paidTo, loggedBy, notes } = req.body ?? {}

    const errors = {}
    if (!category || typeof category !== 'string' || !category.trim()) errors.category = 'Category is required.'
    const amountNum = Number(amount)
    if (!amount || !Number.isFinite(amountNum) || amountNum <= 0) errors.amount = 'Enter a valid amount.'
    maxLength(category, 'category', 100, errors)
    maxLength(description, 'description', 500, errors)
    maxLength(paidTo, 'paidTo', 200, errors)
    maxLength(loggedBy, 'loggedBy', 200, errors)
    maxLength(notes, 'notes', 2000, errors)

    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: errors })
    }

    const { rows } = await pool.query(
      `insert into expenses (expense_date, category, description, amount, listing_id, paid_to, logged_by, notes)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [
        expenseDate || new Date().toISOString().slice(0, 10),
        category,
        description || null,
        amountNum,
        listingId || null,
        paidTo || null,
        loggedBy || null,
        notes || null,
      ],
    )

    logAudit({
      entityType: 'expense',
      entityId: rows[0].id,
      action: 'create',
      changes: { category, amount: amountNum, listingId, paidTo },
      actor: req.adminId,
    })

    res.status(201).json({ id: rows[0].id })
  } catch (err) {
    next(err)
  }
})

router.patch('/:id', async (req, res, next) => {
  try {
    const { id } = req.params
    const body = req.body ?? {}

    const errors = {}
    if (typeof body.reason !== 'string' || !body.reason.trim()) {
      errors.reason = 'Enter a reason for the edit.'
    }
    if ('amount' in body) {
      const amountNum = Number(body.amount)
      if (!Number.isFinite(amountNum) || amountNum < 0) {
        errors.amount = 'Amount must be a non-negative number.'
      }
    }
    if ('category' in body && (typeof body.category !== 'string' || !body.category.trim())) {
      errors.category = 'Category cannot be blank.'
    }
    maxLength(body.category, 'category', 100, errors)
    maxLength(body.description, 'description', 500, errors)
    maxLength(body.paidTo, 'paidTo', 200, errors)
    maxLength(body.loggedBy, 'loggedBy', 200, errors)
    maxLength(body.notes, 'notes', 2000, errors)
    maxLength(body.reason, 'reason', 1000, errors)
    if (Object.keys(errors).length > 0) {
      return res.status(400).json({ error: 'Validation failed', fields: errors })
    }

    const setClauses = []
    const params = []
    for (const [key, column] of Object.entries(EXPENSE_FIELDS)) {
      if (key in body) {
        params.push(body[key])
        setClauses.push(`${column} = $${params.length}`)
      }
    }

    if (setClauses.length === 0) {
      return res.status(400).json({ error: 'No recognized fields to update.' })
    }

    const { rows: before } = await pool.query('select * from expenses where id = $1 and deleted_at is null', [id])
    if (before.length === 0) return res.status(404).json({ error: 'Expense not found' })

    // Optimistic concurrency, same pattern as booking edits: the client
    // sends back the `updated_at` it last saw. If another admin already
    // saved a change to this expense, that value has moved on and this
    // WHERE clause matches zero rows instead of silently overwriting their
    // edit.
    let versionClause = ''
    if (typeof body.expectedUpdatedAt === 'string' && body.expectedUpdatedAt) {
      params.push(body.expectedUpdatedAt)
      versionClause = ` and updated_at = $${params.length}`
    }

    params.push(id)
    const { rows: after } = await pool.query(
      `update expenses set ${setClauses.join(', ')}, updated_at = now()
       where id = $${params.length}${versionClause}
       returning *`,
      params,
    )

    if (after.length === 0) {
      return res.status(409).json({
        error: 'This expense was changed by someone else since you opened it. Reload and try again.',
      })
    }

    const changedKeys = Object.keys(body).filter((key) => key in EXPENSE_FIELDS)
    const beforeCamel = {}
    const afterCamel = {}
    for (const key of changedKeys) {
      const column = EXPENSE_FIELDS[key]
      beforeCamel[key] = before[0][column]
      afterCamel[key] = after[0][column]
    }

    logAudit({
      entityType: 'expense',
      entityId: id,
      action: 'update',
      changes: diffFields(beforeCamel, afterCamel, changedKeys),
      actor: req.adminId,
      reason: body.reason,
    })

    res.json({ id: after[0].id })
  } catch (err) {
    next(err)
  }
})

// No DELETE route, on purpose: expenses are financial records, and the
// owner wants them append-only + editable, never removable by staff — a
// mistaken entry gets corrected via PATCH (which is fully audit-logged),
// not deleted. The `deleted_at` column stays in the schema in case a future
// owner-only "archive" feature needs it, but nothing writes to it anymore.

export default router
