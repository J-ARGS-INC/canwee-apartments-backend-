import { pool } from '../db.js'

// Replaces lib/location.js's hardcoded 3-entry Map with the real
// locations/areas/listings tables added in the 2026-09-20 migration.
// Location -> Area -> Unit, where Area is optional (Abeokuta's 7 units sit
// directly under it; Lagos's units sit under Ikeja/Gbagada).

// Full tree for building UI pickers/filters — a handful of rows, queried
// fresh every call like every other admin lookup in this codebase (no
// in-process cache to keep stale).
export async function getLocationTree() {
  const { rows: locationRows } = await pool.query('select id, name from locations order by name')
  const { rows: areaRows } = await pool.query('select id, location_id, name from areas order by name')
  const { rows: listingRows } = await pool.query(
    'select id, title, unit_code, location_id, area_id from listings order by unit_code',
  )

  return locationRows.map((loc) => {
    const areasForLocation = areaRows
      .filter((a) => a.location_id === loc.id)
      .map((area) => ({
        id: area.id,
        name: area.name,
        units: listingRows
          .filter((l) => l.area_id === area.id)
          .map((l) => ({ id: l.id, title: l.title, unitCode: l.unit_code })),
      }))
    const unitsDirectlyOnLocation = listingRows
      .filter((l) => l.location_id === loc.id && !l.area_id)
      .map((l) => ({ id: l.id, title: l.title, unitCode: l.unit_code }))
    return { id: loc.id, name: loc.name, areas: areasForLocation, units: unitsDirectlyOnLocation }
  })
}

// Given whichever *one* id the client actually picked for an expense's
// scope, looks up its true ancestry server-side and returns the fully
// resolved { locationId, areaId, listingId } triple — so the DB row always
// reflects real hierarchy, never a client-asserted (and possibly
// mismatched) combination. Deepest-wins if more than one is somehow sent.
// Throws { field, message } (caller turns this into a 400) if none given or
// the given id doesn't exist.
export async function resolveExpenseScope({ locationId, areaId, listingId }) {
  if (listingId) {
    const { rows } = await pool.query('select id, location_id, area_id from listings where id = $1', [listingId])
    if (rows.length === 0) throw { field: 'listingId', message: 'Unit not found.' }
    return { locationId: rows[0].location_id, areaId: rows[0].area_id, listingId: rows[0].id }
  }
  if (areaId) {
    const { rows } = await pool.query('select id, location_id from areas where id = $1', [areaId])
    if (rows.length === 0) throw { field: 'areaId', message: 'Area not found.' }
    return { locationId: rows[0].location_id, areaId: rows[0].id, listingId: null }
  }
  if (locationId) {
    const { rows } = await pool.query('select id from locations where id = $1', [locationId])
    if (rows.length === 0) throw { field: 'locationId', message: 'Location not found.' }
    return { locationId: rows[0].id, areaId: null, listingId: null }
  }
  throw { field: 'locationId', message: 'Select a location for this expense.' }
}

// Parses a filter value of the form "location:<id>" | "area:<id>" |
// "unit:<id>" (or falsy/unrecognized -> null, meaning "no filter"/"all").
export function parseLocationFilter(value) {
  if (!value || typeof value !== 'string') return null
  const [level, id] = value.split(':')
  if (!id || !['location', 'area', 'unit'].includes(level)) return null
  return { level, id }
}

// Human label for a parsed filter (or null), for display in the PDF export
// and email digests — "Ikeja" / "Lagos" / "Ikeja Apartment - Unit 1 (4C)".
export async function getFilterLabel(filter) {
  if (!filter) return null
  if (filter.level === 'location') {
    const { rows } = await pool.query('select name from locations where id = $1', [filter.id])
    return rows[0]?.name || filter.id
  }
  if (filter.level === 'area') {
    const { rows } = await pool.query('select name from areas where id = $1', [filter.id])
    return rows[0]?.name || filter.id
  }
  const { rows } = await pool.query('select title, unit_code from listings where id = $1', [filter.id])
  if (rows.length === 0) return filter.id
  return rows[0].unit_code ? `${rows[0].title} (${rows[0].unit_code})` : rows[0].title
}

// Appends a bind param and returns a SQL condition (no leading "and") that
// scopes a query to the given filter. `expenses` has direct location_id/
// area_id/listing_id columns; `bookings` has none of its own — location is
// always derived through its listing, so pass the alias of the *joined
// listings row* (bookings queries here always join listings as `l`).
export function hierarchyFilterCondition(filter, params, { table, alias }) {
  if (!filter) return null
  const column = { location: 'location_id', area: 'area_id', unit: table === 'expenses' ? 'listing_id' : 'id' }[
    filter.level
  ]
  params.push(filter.id)
  return `${alias}.${column} = $${params.length}`
}
