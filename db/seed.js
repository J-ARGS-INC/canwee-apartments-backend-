import 'dotenv/config'
import { pool } from '../src/db.js'

const IKEJA_ADDRESS = 'Along Obafemi Awolowo Way, near Ikeja City Mall & Alausa Shopping Mall, Ikeja, Lagos'
const GBAGADA_ADDRESS = 'Along Oworonshoki Expressway, near iFitness Gym, Gbagada, Lagos'
const IBARA_ADDRESS =
  'No 2 Biobaku Street, Ibara Housing Estate, beside All Access Dental Clinic, near Opic Tower, Abeokuta'

const listings = [
  {
    id: 'ikeja-unit-1-lagos',
    unitCode: '4C',
    bookingPrefix: 'IKE',
    title: 'Ikeja Apartment - Unit 1',
    city: 'Lagos',
    state: 'Lagos',
    neighborhood: 'Ikeja',
    address: IKEJA_ADDRESS,
    pricePerNight: 120000,
    bedrooms: 2,
    bathrooms: 2,
    maxGuests: 4,
    sizeSqm: 70,
    rating: 4.8,
    reviewCount: 14,
    tags: ['Mainland Lagos', 'Near Ikeja City Mall'],
    amenities: ['wifi', 'kitchen', 'ac', 'tv', 'power', 'parking'],
    description:
      'A fully-furnished two-bedroom apartment on Obafemi Awolowo Way, a short drive from Ikeja City Mall and Alausa Shopping Mall.',
    longDescription:
      "This two-bedroom sits right on Obafemi Awolowo Way, close enough to Ikeja City Mall and Alausa Shopping Mall that neither requires much planning. Both bedrooms are fitted with air conditioning, the kitchen is stocked for real cooking rather than takeout, and the living room's smart TV comes preloaded with the usual streaming apps. Backup power keeps things running through any outage on the street.",
    host: { name: 'A Canwee Host', joinedYear: 2024, responseTime: 'within an hour', superhost: true },
  },
  {
    id: 'ikeja-unit-2-lagos',
    unitCode: '4D',
    bookingPrefix: 'IKE',
    title: 'Ikeja Apartment - Unit 2',
    city: 'Lagos',
    state: 'Lagos',
    neighborhood: 'Ikeja',
    address: IKEJA_ADDRESS,
    pricePerNight: 120000,
    bedrooms: 2,
    bathrooms: 2,
    maxGuests: 4,
    sizeSqm: 70,
    rating: 4.75,
    reviewCount: 11,
    tags: ['Mainland Lagos', 'Near Ikeja City Mall'],
    amenities: ['wifi', 'kitchen', 'ac', 'tv', 'power', 'parking'],
    description:
      'The second two-bedroom apartment in the same Ikeja building, on Obafemi Awolowo Way near Ikeja City Mall and Alausa Shopping Mall.',
    longDescription:
      "The sister unit to Ikeja Unit 1, in the same building on Obafemi Awolowo Way. Two air-conditioned bedrooms, a proper kitchen, and a living room built around a smart TV. Good for groups who want two apartments under one roof, or simply the next available date when Unit 1 is booked. Backup power is standard here too.",
    host: { name: 'A Canwee Host', joinedYear: 2024, responseTime: 'within an hour', superhost: false },
  },
  {
    id: 'gbagada-unit-1-lagos',
    unitCode: 'Ndubuisi Kanu Estate Unit',
    bookingPrefix: 'GBA',
    title: 'Gbagada Apartment - Unit 1',
    city: 'Lagos',
    state: 'Lagos',
    neighborhood: 'Gbagada',
    address: GBAGADA_ADDRESS,
    pricePerNight: 120000,
    bedrooms: 2,
    bathrooms: 2,
    maxGuests: 4,
    sizeSqm: 70,
    rating: 4.85,
    reviewCount: 9,
    tags: ['Mainland Lagos', 'Near iFitness Gym'],
    amenities: ['wifi', 'kitchen', 'ac', 'tv', 'power', 'parking'],
    description:
      'A two-bedroom apartment along the Oworonshoki Expressway in Gbagada, a short walk from iFitness Gym.',
    longDescription:
      "Set along the Oworonshoki Expressway in Gbagada, this two-bedroom apartment is a short walk from iFitness Gym and an easy drive to most of mainland Lagos. Both bedrooms come with air conditioning and real closets, the kitchen is fully equipped, and the living room's smart TV covers the usual streaming apps. Backup power means the WiFi and AC stay on regardless of what the grid is doing.",
    host: { name: 'A Canwee Host', joinedYear: 2024, responseTime: 'within an hour', superhost: false },
  },
  {
    id: 'china-downstairs-abeokuta',
    unitCode: 'China 1',
    bookingPrefix: 'ABE',
    title: 'The China Suite, Ibara',
    city: 'Abeokuta',
    state: 'Ogun',
    neighborhood: 'Ibara Housing Estate',
    address: IBARA_ADDRESS,
    pricePerNight: 80000,
    bedrooms: 1,
    bathrooms: 1,
    maxGuests: 2,
    sizeSqm: 45,
    rating: 4.7,
    reviewCount: 8,
    tags: ['Themed suite', 'Ibara Housing Estate'],
    amenities: ['wifi', 'kitchen', 'ac', 'tv', 'power', 'parking'],
    description:
      'A ground-floor one-bedroom suite in the Ibara Housing Estate, beside All Access Dental Clinic and near Opic Tower.',
    longDescription:
      "One of six themed suites Canwee runs inside the same Ibara Housing Estate building, this ground-floor one-bedroom sits beside All Access Dental Clinic and a short drive from Opic Tower. It comes with a full kitchen, air conditioning, and a smart TV, all inside a gated estate with backup power on hand for outages.",
    host: { name: 'A Canwee Host', joinedYear: 2024, responseTime: 'within a few hours', superhost: false },
  },
  {
    id: 'london-abeokuta',
    unitCode: 'London',
    bookingPrefix: 'ABE',
    title: 'The London Suite, Ibara',
    city: 'Abeokuta',
    state: 'Ogun',
    neighborhood: 'Ibara Housing Estate',
    address: IBARA_ADDRESS,
    pricePerNight: 80000,
    bedrooms: 1,
    bathrooms: 1,
    maxGuests: 2,
    sizeSqm: 45,
    rating: 4.75,
    reviewCount: 10,
    tags: ['Themed suite', 'Ibara Housing Estate'],
    amenities: ['wifi', 'kitchen', 'ac', 'tv', 'power', 'parking'],
    description:
      'A one-bedroom suite in the Ibara Housing Estate building, beside All Access Dental Clinic and near Opic Tower.',
    longDescription:
      "The London Suite is one of six themed apartments Canwee runs in the same Ibara Housing Estate building, beside All Access Dental Clinic and near Opic Tower. It has a full kitchen, air conditioning, a smart TV, and steady backup power, inside a gated compound with on-site parking.",
    host: { name: 'A Canwee Host', joinedYear: 2024, responseTime: 'within a few hours', superhost: false },
  },
  {
    id: 'south-africa-abeokuta',
    unitCode: 'South Africa',
    bookingPrefix: 'ABE',
    title: 'The South Africa Suite, Ibara',
    city: 'Abeokuta',
    state: 'Ogun',
    neighborhood: 'Ibara Housing Estate',
    address: IBARA_ADDRESS,
    pricePerNight: 80000,
    bedrooms: 1,
    bathrooms: 1,
    maxGuests: 2,
    sizeSqm: 45,
    rating: 4.8,
    reviewCount: 12,
    tags: ['Themed suite', 'Ibara Housing Estate'],
    amenities: ['wifi', 'kitchen', 'ac', 'tv', 'power', 'parking'],
    description:
      'A one-bedroom suite in the Ibara Housing Estate building, beside All Access Dental Clinic and near Opic Tower.',
    longDescription:
      "The South Africa Suite is one of six themed apartments Canwee runs in the same Ibara Housing Estate building, beside All Access Dental Clinic and near Opic Tower. Expect a full kitchen, air conditioning, a smart TV, and reliable backup power, inside a gated compound with on-site parking.",
    host: { name: 'A Canwee Host', joinedYear: 2024, responseTime: 'within a few hours', superhost: false },
  },
  {
    id: 'canada-abeokuta',
    unitCode: 'Canada',
    bookingPrefix: 'ABE',
    title: 'The Canada Suite, Ibara',
    city: 'Abeokuta',
    state: 'Ogun',
    neighborhood: 'Ibara Housing Estate',
    address: IBARA_ADDRESS,
    pricePerNight: 120000,
    bedrooms: 2,
    bathrooms: 2,
    maxGuests: 4,
    sizeSqm: 68,
    rating: 4.85,
    reviewCount: 13,
    tags: ['Themed suite', 'Ibara Housing Estate'],
    amenities: ['wifi', 'kitchen', 'ac', 'tv', 'power', 'parking'],
    description:
      'A two-bedroom suite in the Ibara Housing Estate building, beside All Access Dental Clinic and near Opic Tower.',
    longDescription:
      "The Canada Suite is the larger, two-bedroom option among the six themed apartments Canwee runs in the same Ibara Housing Estate building, beside All Access Dental Clinic and near Opic Tower. Marble finishes, two air-conditioned bedrooms, a full kitchen, and a smart TV, all backed by steady power inside a gated compound.",
    host: { name: 'A Canwee Host', joinedYear: 2024, responseTime: 'within a few hours', superhost: true },
  },
  {
    id: 'nairobi-abeokuta',
    unitCode: 'Nairobi',
    bookingPrefix: 'ABE',
    title: 'The Nairobi Suite, Ibara',
    city: 'Abeokuta',
    state: 'Ogun',
    neighborhood: 'Ibara Housing Estate',
    address: IBARA_ADDRESS,
    pricePerNight: 120000,
    bedrooms: 2,
    bathrooms: 2,
    maxGuests: 4,
    sizeSqm: 68,
    rating: 4.7,
    reviewCount: 7,
    tags: ['Themed suite', 'Ibara Housing Estate'],
    amenities: ['wifi', 'kitchen', 'ac', 'tv', 'power', 'parking'],
    description:
      'A two-bedroom suite in the Ibara Housing Estate building, beside All Access Dental Clinic and near Opic Tower.',
    longDescription:
      "The Nairobi Suite is a two-bedroom apartment among the six themed suites Canwee runs in the same Ibara Housing Estate building, beside All Access Dental Clinic and near Opic Tower. Both bedrooms have air conditioning, the kitchen is fully equipped, and the living room's smart TV and backup power make it a comfortable base for a family or small group.",
    host: { name: 'A Canwee Host', joinedYear: 2024, responseTime: 'within a few hours', superhost: false },
  },
  {
    id: 'usa-abeokuta',
    unitCode: 'USA',
    bookingPrefix: 'ABE',
    title: 'The USA Suite, Ibara',
    city: 'Abeokuta',
    state: 'Ogun',
    neighborhood: 'Ibara Housing Estate',
    address: IBARA_ADDRESS,
    pricePerNight: 120000,
    bedrooms: 2,
    bathrooms: 2,
    maxGuests: 4,
    sizeSqm: 68,
    rating: 4.9,
    reviewCount: 16,
    tags: ['Themed suite', 'Ibara Housing Estate'],
    amenities: ['wifi', 'kitchen', 'ac', 'tv', 'power', 'parking'],
    description:
      'A two-bedroom suite in the Ibara Housing Estate building, beside All Access Dental Clinic and near Opic Tower.',
    longDescription:
      "The USA Suite rounds out the six themed apartments Canwee runs in the same Ibara Housing Estate building, beside All Access Dental Clinic and near Opic Tower. Two air-conditioned bedrooms, a full kitchen, mood-lit living room with a smart TV, and the same backup power and gated parking as the rest of the building.",
    host: { name: 'A Canwee Host', joinedYear: 2024, responseTime: 'within a few hours', superhost: true },
  },
]

const testimonials = [
  {
    name: 'Chiamaka O.',
    location: 'Stayed in Ikeja, Lagos',
    quote:
      'Every photo matched the apartment exactly, which is rarer than it should be. The estate has 24/7 power and the host answered a question about parking within the hour.',
    rating: 5,
  },
  {
    name: 'Tunde A.',
    location: 'Stayed in Gbagada, Lagos',
    quote:
      "Booked for a work trip that turned into ten days. Backup power, real wifi, and a proper kitchen made it feel less like a rental and more like a second home.",
    rating: 5,
  },
  {
    name: 'Ngozi E.',
    location: 'Stayed in the Canada Suite, Abeokuta',
    quote:
      'The cancellation policy was clearly written before we booked, not buried in a confirmation email after. When our plans changed, refunding the difference took one message.',
    rating: 5,
  },
  {
    name: 'Ibrahim M.',
    location: 'Stayed in the London Suite, Abeokuta',
    quote:
      'Booked a one-bedroom for a solo trip and it was spotless, quiet, and exactly where the map said it would be. No surprise fees at checkout either.',
    rating: 4.8,
  },
  {
    name: 'Folake B.',
    location: 'Stayed in the USA Suite, Abeokuta',
    quote:
      'Traveling with family usually means someone is uncomfortable. This time everyone had a real bedroom and steady power, and we still had money left for the trip.',
    rating: 5,
  },
]

const faqs = [
  {
    question: 'How is Canwee different from a hotel booking?',
    answer:
      "Every apartment on Canwee is a real, fully-furnished home, not a hotel room. You get a real kitchen, real square footage, and a neighborhood instead of a lobby. Pricing is shown up front with no resort fees or surprise charges added at checkout.",
  },
  {
    question: 'Are the listings verified?',
    answer:
      "Yes. Every property goes through a verification step before it appears in search results, including a review of photos, amenities, and the host's response history. Listings that fall out of good standing are removed from search.",
  },
  {
    question: 'What happens if I need to cancel?',
    answer:
      'Cancellation terms are shown on every listing before you book, not after. Most stays can be cancelled with a full refund up to 7 days before check-in. See our Cancellation Policy page for the exact terms that apply to your dates.',
  },
  {
    question: 'Is there a minimum or maximum length of stay?',
    answer:
      "Most apartments accept stays from 2 nights up to several months. If you're planning an extended stay, message the host directly from the listing page to confirm availability and any long-stay pricing.",
  },
  {
    question: 'How do I get the keys or access code?',
    answer:
      "Check-in instructions and access details are sent automatically 24 hours before arrival. Instructions are also available anytime from your booking confirmation.",
  },
  {
    question: "What if the apartment isn't as described?",
    answer:
      "Contact our support team within 24 hours of check-in through the Contact page and we'll work with you and the host on a resolution, which can include relocation or a partial refund depending on the issue.",
  },
]

async function seed() {
  // Upsert by id, NOT delete-and-reinsert: listings.id is a real foreign
  // key that bookings, listing_images, and expenses all reference. This
  // script used to `delete from bookings` / `delete from listing_images`
  // before reinserting, which was fine while both were empty demo data —
  // now that real guest bookings and real listing photos exist in
  // production, that would silently destroy them every time someone reruns
  // this script just to fix a typo in a description. Never reintroduce
  // those deletes here.
  for (const listing of listings) {
    await pool.query(
      `insert into listings (
        id, title, city, state, neighborhood, address, price_per_night, bedrooms, bathrooms,
        max_guests, size_sqm, rating, review_count, tags, amenities, images,
        description, long_description, host_name, host_joined_year, host_response_time, host_superhost,
        unit_code, booking_prefix
      ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
      on conflict (id) do update set
        title = excluded.title,
        city = excluded.city,
        state = excluded.state,
        neighborhood = excluded.neighborhood,
        address = excluded.address,
        price_per_night = excluded.price_per_night,
        bedrooms = excluded.bedrooms,
        bathrooms = excluded.bathrooms,
        max_guests = excluded.max_guests,
        size_sqm = excluded.size_sqm,
        rating = excluded.rating,
        review_count = excluded.review_count,
        tags = excluded.tags,
        amenities = excluded.amenities,
        description = excluded.description,
        long_description = excluded.long_description,
        host_name = excluded.host_name,
        host_joined_year = excluded.host_joined_year,
        host_response_time = excluded.host_response_time,
        host_superhost = excluded.host_superhost,
        unit_code = excluded.unit_code,
        booking_prefix = excluded.booking_prefix`,
      [
        listing.id,
        listing.title,
        listing.city,
        listing.state,
        listing.neighborhood,
        listing.address,
        listing.pricePerNight,
        listing.bedrooms,
        listing.bathrooms,
        listing.maxGuests,
        listing.sizeSqm,
        listing.rating,
        listing.reviewCount,
        listing.tags,
        listing.amenities,
        [],
        listing.description,
        listing.longDescription,
        listing.host.name,
        listing.host.joinedYear,
        listing.host.responseTime,
        listing.host.superhost,
        listing.unitCode,
        listing.bookingPrefix,
      ],
    )
  }

  await pool.query('delete from testimonials')
  for (const testimonial of testimonials) {
    await pool.query(
      'insert into testimonials (name, location, quote, rating) values ($1,$2,$3,$4)',
      [testimonial.name, testimonial.location, testimonial.quote, testimonial.rating],
    )
  }

  await pool.query('delete from faqs')
  for (const [index, faq] of faqs.entries()) {
    await pool.query(
      'insert into faqs (question, answer, sort_order) values ($1,$2,$3)',
      [faq.question, faq.answer, index],
    )
  }

  console.log(`Seeded ${listings.length} listings, ${testimonials.length} testimonials, ${faqs.length} faqs.`)
  await pool.end()
}

seed().catch((err) => {
  console.error('Seed failed:', err)
  process.exit(1)
})
