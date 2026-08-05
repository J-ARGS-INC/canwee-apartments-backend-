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

-- Guest email is required for the public booking form (guests need the
-- confirmation email), but admin-entered offline bookings (WhatsApp,
-- Instagram, walk-in) frequently have no email on file at all.
alter table bookings alter column email drop not null;

-- Idempotency keys for POST /api/bookings and POST /api/contact: a client
-- retrying a timed-out request (or a double form submit) reuses the same
-- key, so the second attempt replays the first response instead of
-- creating a duplicate booking/message. Rows are cheap and self-limiting in
-- practice (one per real submission); a scheduled cleanup isn't critical at
-- this scale but `created_at` is kept so one can be added later.
create table if not exists idempotency_keys (
  key text primary key,
  status_code int not null,
  response jsonb not null,
  created_at timestamptz not null default now()
);

-- Property-management fields (2026-08-05) to match the operator's existing
-- booking-tracking spreadsheet: a short unit identifier + human-readable
-- booking codes (IKE-0001, ABE-0008, etc), plus payment/financial tracking
-- per booking and a general expense log. `unit_code` and `booking_prefix`
-- live on listings since they describe the physical unit, not one stay.
alter table listings add column if not exists unit_code text;
alter table listings add column if not exists booking_prefix text;

alter table bookings add column if not exists booking_code text unique;
alter table bookings add column if not exists booking_date date not null default current_date;
alter table bookings add column if not exists rate_per_night numeric;
alter table bookings add column if not exists discount numeric not null default 0;
alter table bookings add column if not exists total_amount numeric;
alter table bookings add column if not exists amount_paid numeric not null default 0;
alter table bookings add column if not exists payment_status text not null default 'unpaid';
alter table bookings add column if not exists payment_method text;
alter table bookings add column if not exists payment_date date;
alter table bookings add column if not exists source_channel text;
alter table bookings add column if not exists received_by text;

alter table bookings drop constraint if exists bookings_payment_status_check;
alter table bookings add constraint bookings_payment_status_check
  check (payment_status in ('unpaid', 'part_payment', 'paid', 'overpaid'));

-- balance is always total - paid; a generated column keeps it correct
-- automatically instead of relying on every write path to recompute it.
alter table bookings drop column if exists balance;
alter table bookings add column balance numeric generated always as (coalesce(total_amount, 0) - amount_paid) stored;

-- Continues the operator's existing spreadsheet numbering (their last
-- entry was IKE-0015), so system-generated codes don't collide with or
-- restart the sequence they've already been using.
create sequence if not exists booking_code_seq start 16;

create or replace function set_booking_code() returns trigger as $$
declare
  prefix text;
begin
  if new.booking_code is null then
    select booking_prefix into prefix from listings where id = new.listing_id;
    new.booking_code := coalesce(prefix, 'BK') || '-' || lpad(nextval('booking_code_seq')::text, 4, '0');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_set_booking_code on bookings;
create trigger trg_set_booking_code before insert on bookings
  for each row execute function set_booking_code();

create table if not exists expenses (
  id uuid primary key default gen_random_uuid(),
  expense_date date not null default current_date,
  category text not null,
  description text,
  amount numeric not null,
  listing_id text references listings(id),
  paid_to text,
  logged_by text,
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists expenses_date_idx on expenses (expense_date);
create index if not exists bookings_booking_code_idx on bookings (booking_code);

-- Financial-integrity hardening (2026-08-05). Every admin who has the
-- shared ADMIN_API_KEY has equal write access to money fields — there is
-- no per-staff login, so this cannot cryptographically prove who made a
-- change, only (a) stop obviously-invalid values at the DB level as a hard
-- backstop even if application validation is ever bypassed/buggy, and
-- (b) keep an immutable record of every change for after-the-fact review.
alter table bookings drop constraint if exists bookings_nonnegative_amounts_check;
alter table bookings add constraint bookings_nonnegative_amounts_check
  check (
    (rate_per_night is null or rate_per_night >= 0)
    and discount >= 0
    and (total_amount is null or total_amount >= 0)
    and amount_paid >= 0
  );

alter table expenses drop constraint if exists expenses_amount_nonnegative_check;
alter table expenses add constraint expenses_amount_nonnegative_check check (amount >= 0);

-- Expenses are soft-deleted, not removed, so a deleted-to-hide-evidence
-- expense still exists in the table (just hidden from normal queries) —
-- the audit_log entry below also captures its full contents at delete time.
alter table expenses add column if not exists deleted_at timestamptz;

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null,
  action text not null,
  changes jsonb,
  actor text,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_entity_idx on audit_log (entity_type, entity_id);
create index if not exists audit_log_created_at_idx on audit_log (created_at desc);

-- Every edit (not creation, not routine status transitions) must be
-- justified. Enforced in application code (PATCH .../details and PATCH
-- expenses/:id both 400 if `reason` is missing/blank) — this column just
-- gives it a durable, queryable home rather than burying it in the
-- freeform `changes` jsonb.
alter table audit_log add column if not exists reason text;

-- Individual admin accounts (2026-08-05), replacing the single shared
-- ADMIN_API_KEY as the source of "who did this." With one shared key,
-- audit_log.actor could only ever be self-reported free text (whatever
-- someone typed into a Received By/Logged By box) — not proof of anything.
-- Real accounts + password auth mean audit_log.actor is now the verified,
-- logged-in admin's id, not a guess.
create table if not exists admin_users (
  id text primary key,
  display_name text,
  password_hash text not null,
  created_at timestamptz not null default now()
);

-- Real-time revocation + roles (2026-08-05). JWTs are normally stateless —
-- a signed token stays valid until it expires regardless of what happens
-- server-side afterward. That's not good enough for "removing an admin
-- must invalidate them immediately," so `requireAdmin` looks up the
-- account fresh on every request instead of trusting the token's claims
-- for anything beyond "which id was authenticated." `is_active = false`
-- blocks both new logins and any still-live session instantly, and it's a
-- flag (not a delete) so audit_log.actor rows referencing this id stay
-- intact forever.
alter table admin_users add column if not exists role text not null default 'admin';
alter table admin_users add column if not exists is_active boolean not null default true;

alter table admin_users drop constraint if exists admin_users_role_check;
alter table admin_users add constraint admin_users_role_check check (role in ('admin', 'super_admin'));
