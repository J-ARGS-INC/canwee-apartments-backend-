-- Run this once in the Supabase SQL editor (or via psql) before seeding.

create table if not exists listings (
  id text primary key,
  title text not null,
  city text not null,
  state text not null,
  neighborhood text not null,
  address text,
  price_per_night int not null,
  bedrooms int not null,
  bathrooms int not null,
  max_guests int not null,
  size_sqm int not null,
  rating numeric not null,
  review_count int not null,
  tags text[] not null default '{}',
  amenities text[] not null default '{}',
  images text[] not null default '{}',
  description text not null,
  long_description text not null,
  host_name text not null,
  host_joined_year int not null,
  host_response_time text not null,
  host_superhost boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists bookings (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references listings(id),
  full_name text not null,
  email text not null,
  phone text not null,
  check_in date not null,
  check_out date not null,
  guests int not null,
  notes text,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

create table if not exists contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  topic text not null,
  message text not null,
  created_at timestamptz not null default now()
);

create table if not exists testimonials (
  id serial primary key,
  name text not null,
  location text not null,
  quote text not null,
  rating numeric not null
);

create table if not exists faqs (
  id serial primary key,
  question text not null,
  answer text not null,
  sort_order int not null default 0
);

create table if not exists listing_images (
  id uuid primary key default gen_random_uuid(),
  listing_id text not null references listings(id) on delete cascade,
  sort_order int not null default 0,
  content_type text not null default 'image/jpeg',
  data bytea not null,
  created_at timestamptz not null default now()
);

create index if not exists listings_city_idx on listings (city);
create index if not exists bookings_listing_id_idx on bookings (listing_id);
create index if not exists listing_images_listing_id_idx on listing_images (listing_id, sort_order);

-- Street address for guest directions (added after initial launch, safe to rerun).
alter table listings add column if not exists address text;

-- Admin check-in/check-out workflow (added after initial launch, safe to rerun).
alter table bookings add column if not exists actual_check_in_at timestamptz;
alter table bookings add column if not exists actual_check_out_at timestamptz;
alter table bookings add column if not exists updated_at timestamptz not null default now();

alter table bookings drop constraint if exists bookings_status_check;
alter table bookings add constraint bookings_status_check
  check (status in ('pending', 'confirmed', 'checked_in', 'checked_out', 'cancelled'));
