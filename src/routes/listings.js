import { Router } from 'express'
import { pool } from '../db.js'

const router = Router()

function mapListing(row, baseUrl, imagesByListing) {
  return {
    id: row.id,
    title: row.title,
    city: row.city,
    state: row.state,
    neighborhood: row.neighborhood,
    address: row.address,
    pricePerNight: row.price_per_night,
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    maxGuests: row.max_guests,
    sizeSqm: row.size_sqm,
    rating: Number(row.rating),
    reviewCount: row.review_count,
    tags: row.tags,
    amenities: row.amenities,
    images: (imagesByListing.get(row.id) || []).map((imageId) => `${baseUrl}/api/images/${imageId}`),
    description: row.description,
    longDescription: row.long_description,
    host: {
      name: row.host_name,
      joinedYear: row.host_joined_year,
      responseTime: row.host_response_time,
      superhost: row.host_superhost,
    },
  }
}

function getBaseUrl(req) {
  return `${req.protocol}://${req.get('host')}`
}

async function fetchImagesByListing(listingIds) {
  const imagesByListing = new Map()
  if (listingIds.length === 0) return imagesByListing

  const { rows } = await pool.query(
    'select id, listing_id from listing_images where listing_id = any($1::text[]) order by listing_id, sort_order',
    [listingIds],
  )
  for (const row of rows) {
    if (!imagesByListing.has(row.listing_id)) imagesByListing.set(row.listing_id, [])
    imagesByListing.get(row.listing_id).push(row.id)
  }
  return imagesByListing
}

const SORTS = {
  'price-asc': 'price_per_night asc',
  'price-desc': 'price_per_night desc',
  rating: 'rating desc',
  recommended: 'rating desc',
}

router.get('/', async (req, res, next) => {
  try {
    const { city, guests, bedrooms, price, sort, featured } = req.query

    const conditions = []
    const params = []

    if (city) {
      params.push(city)
      conditions.push(`city = $${params.length}`)
    }
    if (guests) {
      params.push(Number(guests))
      conditions.push(`max_guests >= $${params.length}`)
    }
    if (bedrooms && bedrooms !== 'any') {
      if (bedrooms === '3+') {
        conditions.push('bedrooms >= 3')
      } else {
        params.push(Number(bedrooms))
        conditions.push(`bedrooms = $${params.length}`)
      }
    }
    if (price === 'under-25000') {
      conditions.push('price_per_night < 25000')
    } else if (price === '25000-45000') {
      conditions.push('price_per_night between 25000 and 45000')
    } else if (price === 'over-45000') {
      conditions.push('price_per_night > 45000')
    }

    const where = conditions.length ? `where ${conditions.join(' and ')}` : ''
    const orderBy = SORTS[sort] || SORTS.recommended
    const limit = featured ? 'limit 6' : ''

    const { rows } = await pool.query(
      `select * from listings ${where} order by ${orderBy} ${limit}`,
      params,
    )
    const baseUrl = getBaseUrl(req)
    const imagesByListing = await fetchImagesByListing(rows.map((row) => row.id))
    res.json(rows.map((row) => mapListing(row, baseUrl, imagesByListing)))
  } catch (err) {
    next(err)
  }
})

router.get('/cities', async (req, res, next) => {
  try {
    const { rows } = await pool.query('select distinct city from listings order by city')
    res.json(rows.map((row) => row.city))
  } catch (err) {
    next(err)
  }
})

router.get('/:id', async (req, res, next) => {
  try {
    const { rows } = await pool.query('select * from listings where id = $1', [req.params.id])
    if (rows.length === 0) return res.status(404).json({ error: 'Listing not found' })
    const baseUrl = getBaseUrl(req)
    const imagesByListing = await fetchImagesByListing([rows[0].id])
    res.json(mapListing(rows[0], baseUrl, imagesByListing))
  } catch (err) {
    next(err)
  }
})

router.get('/:id/related', async (req, res, next) => {
  try {
    const { rows: current } = await pool.query('select city from listings where id = $1', [req.params.id])
    if (current.length === 0) return res.json([])

    const { rows } = await pool.query(
      'select * from listings where city = $1 and id != $2 limit 3',
      [current[0].city, req.params.id],
    )
    const baseUrl = getBaseUrl(req)
    const imagesByListing = await fetchImagesByListing(rows.map((row) => row.id))
    res.json(rows.map((row) => mapListing(row, baseUrl, imagesByListing)))
  } catch (err) {
    next(err)
  }
})

export default router
