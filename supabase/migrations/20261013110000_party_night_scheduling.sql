-- Rider party-night scheduling. Additive only.
-- New tables. Does not alter trips, friend_rides, payments, or driver tables.
-- Each member stores a pre-authorization hold (hold_kind = preauth).
-- There is no deposit column. The hold is not captured when the night is scheduled.
-- The return queue is the rider side of the College Ave late-night party-ride
-- queue: Thursday–Saturday, 10pm–3am Eastern.

create table if not exists public.party_nights (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null,
  token text not null,
  status text not null default 'scheduled',
  pickup_label text not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  dropoff_label text not null,
  dropoff_lat double precision not null,
  dropoff_lng double precision not null,
  pickup_at timestamptz not null,
  estimated_fare_cents integer not null,
  return_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint party_nights_status_known check (status in ('scheduled', 'canceled')),
  constraint party_nights_fare_nonneg check (estimated_fare_cents >= 0)
);

create unique index if not exists party_nights_token_uidx on public.party_nights (token);
create index if not exists party_nights_organizer_idx on public.party_nights (organizer_id, pickup_at);
create index if not exists party_nights_pickup_idx on public.party_nights (pickup_at) where status = 'scheduled';

comment on table public.party_nights is
  'A group night-out ride scheduled ahead of time. Fare shares are pre-authorization holds, not deposits.';

create table if not exists public.party_night_members (
  id uuid primary key default gen_random_uuid(),
  party_night_id uuid not null references public.party_nights (id) on delete cascade,
  user_id uuid not null,
  display_name text not null,
  share_cents integer not null,
  hold_cents integer not null,
  buffer_cents integer not null,
  hold_kind text not null default 'preauth',
  joined_at timestamptz not null default now(),
  constraint party_night_members_hold_kind check (hold_kind = 'preauth'),
  constraint party_night_members_amounts_nonneg check (
    share_cents >= 0 and hold_cents >= 0 and buffer_cents >= 0 and hold_cents >= share_cents
  )
);

create unique index if not exists party_night_members_user_uidx
  on public.party_night_members (party_night_id, user_id);
create index if not exists party_night_members_user_idx on public.party_night_members (user_id);

comment on column public.party_night_members.hold_kind is
  'preauth: fare authorization hold for this share. Not a deposit. Nothing is captured at schedule time.';
comment on column public.party_night_members.hold_cents is
  'Pre-authorization amount: share plus buffer. Not a deposit.';

create table if not exists public.party_return_queue (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null,
  party_night_id uuid references public.party_nights (id) on delete set null,
  display_name text,
  pickup_label text not null,
  pickup_lat double precision not null,
  pickup_lng double precision not null,
  dropoff_label text,
  dropoff_lat double precision,
  dropoff_lng double precision,
  status text not null default 'waiting',
  joined_at timestamptz not null default now(),
  constraint party_return_queue_status_known check (status in ('waiting', 'left'))
);

create unique index if not exists party_return_queue_waiting_rider_uidx
  on public.party_return_queue (rider_id)
  where status = 'waiting';
create index if not exists party_return_queue_waiting_joined_idx
  on public.party_return_queue (joined_at)
  where status = 'waiting';

comment on table public.party_return_queue is
  'Riders waiting for a late-night ride home from College Ave. FIFO by joined_at while the party-ride window is open.';

alter table public.party_nights enable row level security;
alter table public.party_night_members enable row level security;
alter table public.party_return_queue enable row level security;

-- Own-row checks only. A policy that reads the other party-night table
-- re-enters row security and recurses. The invite API uses the service role.
drop policy if exists party_nights_member_select on public.party_nights;
create policy party_nights_member_select
on public.party_nights
for select
to authenticated
using (organizer_id = auth.uid());

drop policy if exists party_night_members_select on public.party_night_members;
create policy party_night_members_select
on public.party_night_members
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists party_return_queue_select on public.party_return_queue;
create policy party_return_queue_select
on public.party_return_queue
for select
to authenticated
using (rider_id = auth.uid());

grant select on table public.party_nights to authenticated;
grant select on table public.party_night_members to authenticated;
grant select on table public.party_return_queue to authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant select, insert, update, delete on table public.party_nights to service_role;
    grant select, insert, update, delete on table public.party_night_members to service_role;
    grant select, insert, update, delete on table public.party_return_queue to service_role;
  end if;
end $$;
