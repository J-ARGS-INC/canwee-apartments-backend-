// Canwee's 3 real locations, mirrored from src/lib/locations.js on the
// frontend. Kept here rather than shared/imported since the server and
// frontend are separate deployables with no shared module boundary.
// Abeokuta is matched by city alone below — there is only one Abeokuta
// location and its `neighborhood` column holds a building name ("Ibara
// Housing Estate"), not "Abeokuta" — while Ikeja/Gbagada need both city
// and neighborhood since they share a city ("Lagos").
// A Map, not a plain object — `location` is attacker-controlled request
// input, and plain-object bracket lookup (`LOCATIONS[location]`) resolves
// inherited keys like "__proto__"/"constructor"/"toString" to a truthy
// prototype-chain object instead of undefined, which would otherwise push
// `undefined` into a query's bind params and throw. A Map has no prototype
// chain to fall through, so an unrecognized key always misses cleanly.
const LOCATIONS = new Map([
  ['ikeja', { city: 'Lagos', neighborhood: 'Ikeja' }],
  ['gbagada', { city: 'Lagos', neighborhood: 'Gbagada' }],
  ['abeokuta', { city: 'Abeokuta', neighborhood: null }],
])

// Appends bind params for the given location id and returns a SQL
// condition (no leading "and"), or null if `location` isn't recognized.
export function locationCondition(location, params, alias = 'l') {
  if (typeof location !== 'string') return null
  const loc = LOCATIONS.get(location)
  if (!loc) return null
  params.push(loc.city)
  const cityIdx = params.length
  if (!loc.neighborhood) return `${alias}.city = $${cityIdx}`
  params.push(loc.neighborhood)
  return `${alias}.city = $${cityIdx} and ${alias}.neighborhood = $${params.length}`
}

// SQL expression producing a human label matching the 3 known locations,
// for GROUP BY breakdowns. Falls back to 'Unassigned' when there is no
// joined listing at all (e.g. a general expense with no listing_id) and to
// the raw city for any listing that doesn't match a known neighborhood
// (defensive — not expected to hit with the current 11 listings).
export function locationLabelSql(alias = 'l') {
  return `case
    when ${alias}.city = 'Abeokuta' then 'Abeokuta'
    when ${alias}.neighborhood = 'Ikeja' then 'Ikeja'
    when ${alias}.neighborhood = 'Gbagada' then 'Gbagada'
    when ${alias}.city is not null then ${alias}.city
    else 'Unassigned'
  end`
}
