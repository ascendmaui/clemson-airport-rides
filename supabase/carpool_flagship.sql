-- Additive carpool flagship tables. Does not alter or drop friend_rides.
-- Queue is service-role only (RLS on, no policies) so exact pins stay off the client.

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

create index if not exists carpool_requests_open_idx
  on public.carpool_requests (status, depart_at);

alter table public.carpool_requests enable row level security;

create table if not exists public.first_ride_grants (
  user_id uuid primary key,
  email_norm text unique,
  trip_id uuid,
  friend_ride_id uuid,
  code_type text not null default 'first_ride',
  created_at timestamptz not null default now(),
  constraint first_ride_grants_code_type_check check (code_type = 'first_ride')
);

alter table public.first_ride_grants enable row level security;

create table if not exists public.ambassador_codes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null unique,
  code text not null unique,
  code_type text not null default 'ambassador',
  created_at timestamptz not null default now(),
  constraint ambassador_codes_code_type_check check (code_type = 'ambassador')
);

alter table public.ambassador_codes enable row level security;

create table if not exists public.ambassador_payout_ledger (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  code_type text not null default 'ambassador',
  profile_id uuid,
  trip_id uuid,
  friend_ride_id uuid,
  seats integer not null default 0,
  amount_cents integer not null default 0,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  constraint ambassador_payout_ledger_code_type_check check (code_type = 'ambassador')
);

create index if not exists ambassador_payout_ledger_code_idx
  on public.ambassador_payout_ledger (code, created_at desc);

alter table public.ambassador_payout_ledger enable row level security;
