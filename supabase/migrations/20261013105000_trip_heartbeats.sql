-- Last time each app confirmed it was still open on an active trip.
-- The stale-trip sweep also reads location rows. Null until a server heartbeat.
-- Additive only.

alter table public.trips add column if not exists rider_heartbeat_at timestamptz;
alter table public.trips add column if not exists driver_heartbeat_at timestamptz;

comment on column public.trips.rider_heartbeat_at is
  'Last rider-app heartbeat on this trip. A crash stops this clock.';
comment on column public.trips.driver_heartbeat_at is
  'Last driver-app heartbeat on this trip.';

create index if not exists trips_stale_active_accepted_idx
  on public.trips (accepted_at)
  where status in ('accepted', 'arriving', 'arrived', 'in_progress');
