-- Ride-tier carpool seat queue. Additive only.
-- Reuses carpool_requests when that table already exists.
-- trips.tier stays as added in 20261007231000_carpool_ride_tier.sql.

create table if not exists public.carpool_requests (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid,
  display_name text,
  pickup jsonb,
  dropoff jsonb,
  depart_at timestamptz not null default now(),
  status text not null default 'open',
  priority text,
  neighborhood_id text,
  dest_geohash text,
  friend_ride_id uuid,
  party_type text not null default 'carpool',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.carpool_requests add column if not exists trip_id uuid;
alter table public.carpool_requests add column if not exists seat_fare_cents integer;
alter table public.carpool_requests add column if not exists hold_cents integer;

create index if not exists carpool_requests_open_idx
  on public.carpool_requests (status, depart_at);

alter table public.carpool_requests enable row level security;
