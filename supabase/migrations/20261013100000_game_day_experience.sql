-- Game-day experience: stadium zone guide, hot-time windows, driver prep,
-- and the post-game pickup queue. Additive. game_day_events stays the fare
-- schedule. This migration does not read driver_perk_config or clemson_events;
-- the app uses those tables when they exist.

create table if not exists public.game_day_zones (
  id uuid primary key,
  event_id uuid,
  kind text not null,
  name text not null,
  instructions text not null,
  walk_minutes integer,
  lat double precision,
  lng double precision,
  sort_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  constraint game_day_zones_kind_check check (kind = any (array['pickup'::text, 'dropoff'::text])),
  constraint game_day_zones_walk_check check (walk_minutes is null or walk_minutes >= 0)
);

create table if not exists public.game_day_zone_windows (
  id uuid primary key,
  zone_id uuid,
  label text not null,
  offset_start_minutes integer not null,
  offset_end_minutes integer not null,
  heat text not null,
  note text,
  sort_order integer not null default 0,
  active boolean not null default true,
  constraint game_day_zone_windows_heat_check check (heat = any (array['warm'::text, 'hot'::text, 'peak'::text])),
  constraint game_day_zone_windows_span_check check (offset_end_minutes > offset_start_minutes)
);

create table if not exists public.game_day_prep_items (
  id text primary key,
  title text not null,
  detail text not null,
  sort_order integer not null default 0,
  active boolean not null default true
);

create table if not exists public.game_day_prep_checks (
  driver_id uuid not null,
  event_id uuid not null,
  item_id text not null,
  checked_at timestamptz not null default now(),
  primary key (driver_id, event_id, item_id)
);

create table if not exists public.game_day_pickup_queue (
  event_id uuid primary key,
  status text not null,
  riders_waiting integer not null default 0,
  drivers_staged integer not null default 0,
  wait_minutes integer,
  note text,
  updated_at timestamptz not null default now(),
  constraint game_day_pickup_queue_status_check check (status = any (array['forming'::text, 'open'::text, 'busy'::text, 'paused'::text, 'closed'::text])),
  constraint game_day_pickup_queue_counts_check check (riders_waiting >= 0 and drivers_staged >= 0 and (wait_minutes is null or wait_minutes >= 0))
);

do $$
begin
  if to_regclass('public.game_day_events') is not null
     and not exists (select 1 from pg_constraint where conname = 'game_day_zones_event_id_fkey') then
    alter table public.game_day_zones
      add constraint game_day_zones_event_id_fkey
      foreign key (event_id) references public.game_day_events(id) on delete cascade;
  end if;
  if to_regclass('public.game_day_events') is not null
     and not exists (select 1 from pg_constraint where conname = 'game_day_pickup_queue_event_id_fkey') then
    alter table public.game_day_pickup_queue
      add constraint game_day_pickup_queue_event_id_fkey
      foreign key (event_id) references public.game_day_events(id) on delete cascade;
  end if;
  if to_regclass('public.game_day_events') is not null
     and not exists (select 1 from pg_constraint where conname = 'game_day_prep_checks_event_id_fkey') then
    alter table public.game_day_prep_checks
      add constraint game_day_prep_checks_event_id_fkey
      foreign key (event_id) references public.game_day_events(id) on delete cascade;
  end if;
  if to_regclass('public.profiles') is not null
     and not exists (select 1 from pg_constraint where conname = 'game_day_prep_checks_driver_id_fkey') then
    alter table public.game_day_prep_checks
      add constraint game_day_prep_checks_driver_id_fkey
      foreign key (driver_id) references public.profiles(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_day_prep_checks_item_id_fkey') then
    alter table public.game_day_prep_checks
      add constraint game_day_prep_checks_item_id_fkey
      foreign key (item_id) references public.game_day_prep_items(id) on delete cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'game_day_zone_windows_zone_id_fkey') then
    alter table public.game_day_zone_windows
      add constraint game_day_zone_windows_zone_id_fkey
      foreign key (zone_id) references public.game_day_zones(id) on delete cascade;
  end if;
end
$$;

create index if not exists game_day_zones_active_idx on public.game_day_zones (active, sort_order);
create index if not exists game_day_zone_windows_active_idx on public.game_day_zone_windows (active, sort_order);
create index if not exists game_day_prep_checks_driver_idx on public.game_day_prep_checks (driver_id, event_id);

comment on table public.game_day_zones is 'Stadium pickup and drop-off guide. event_id null is the standing guide.';
comment on table public.game_day_zone_windows is 'Hot times as minute offsets from kickoff.';
comment on table public.game_day_prep_items is 'Driver game-day prep checklist.';
comment on table public.game_day_prep_checks is 'Which prep items a driver marked ready for one game.';
comment on table public.game_day_pickup_queue is 'Post-game pickup queue snapshot. The app derives a status when the row is stale.';

insert into public.game_day_zones (id, event_id, kind, name, instructions, walk_minutes, lat, lng, sort_order)
values
  ('a6101300-0000-4000-8000-000000000001', null, 'pickup', 'North plaza', 'Walk to the north pedestrian plaza. Drivers stage on the outer curb, passenger side.', 4, 34.6812, -82.8432, 1),
  ('a6101300-0000-4000-8000-000000000002', null, 'pickup', 'West curb', 'Outer row of the west lot. Stay off the fire lane and do not wait in a tunnel.', 6, 34.6788, -82.8465, 2),
  ('a6101300-0000-4000-8000-000000000003', null, 'dropoff', 'East gate', 'Drop-off only. Drivers unload and leave with the lane. No waiting.', 3, 34.6786, -82.8398, 3),
  ('a6101300-0000-4000-8000-000000000004', null, 'dropoff', 'South loop', 'One-way loop. Follow the posted arrows and exit with traffic.', 5, 34.6762, -82.8430, 4)
on conflict (id) do nothing;

insert into public.game_day_zone_windows (id, zone_id, label, offset_start_minutes, offset_end_minutes, heat, note, sort_order)
values
  ('b6101300-0000-4000-8000-000000000001', null, 'Arrivals', -180, -60, 'warm', 'Riders heading to the gates. Stage at the pickup curbs.', 1),
  ('b6101300-0000-4000-8000-000000000002', null, 'Kickoff rush', -60, -10, 'peak', 'Shortest walks fill first. Drop-off lanes move one car at a time.', 2),
  ('b6101300-0000-4000-8000-000000000003', null, 'In the seats', -10, 200, 'warm', 'Quiet stretch. Keep the post-game curb clear.', 3),
  ('b6101300-0000-4000-8000-000000000004', null, 'Final whistle', 200, 260, 'peak', 'Post-game pickup queue opens. North plaza and the west curb are hottest.', 4),
  ('b6101300-0000-4000-8000-000000000005', null, 'Late exits', 260, 380, 'hot', 'The line thins. Stay in the posted lane until the queue closes.', 5)
on conflict (id) do nothing;

insert into public.game_day_prep_items (id, title, detail, sort_order)
values
  ('charge', 'Charge the phone and the car', 'A stadium shift runs through the late exits.', 1),
  ('zones', 'Read the pickup and drop-off zones', 'Stage on the outer curb. Do not block a fire lane or a tunnel.', 2),
  ('surge', 'Check the fare multiplier', 'The charged rate is on this screen before you go online.', 3),
  ('queue', 'Plan for the post-game line', 'The pickup queue opens after the game. Hot times are on the timeline.', 4),
  ('traffic', 'Follow posted traffic control', 'If an officer moves you off the pin, follow the officer.', 5)
on conflict (id) do nothing;

alter table public.game_day_zones enable row level security;
alter table public.game_day_zone_windows enable row level security;
alter table public.game_day_prep_items enable row level security;
alter table public.game_day_prep_checks enable row level security;
alter table public.game_day_pickup_queue enable row level security;

revoke all on table public.game_day_zones from public, anon, authenticated;
revoke all on table public.game_day_zone_windows from public, anon, authenticated;
revoke all on table public.game_day_prep_items from public, anon, authenticated;
revoke all on table public.game_day_prep_checks from public, anon, authenticated;
revoke all on table public.game_day_pickup_queue from public, anon, authenticated;

grant select on table public.game_day_zones to anon, authenticated;
grant select on table public.game_day_zone_windows to anon, authenticated;
grant select on table public.game_day_prep_items to anon, authenticated;
grant select on table public.game_day_pickup_queue to anon, authenticated;
grant select, insert, update, delete on table public.game_day_prep_checks to authenticated;
grant select, insert, update, delete on table public.game_day_zones to authenticated;
grant select, insert, update, delete on table public.game_day_zone_windows to authenticated;
grant select, insert, update, delete on table public.game_day_prep_items to authenticated;
grant select, insert, update, delete on table public.game_day_pickup_queue to authenticated;

grant all on table public.game_day_zones to service_role;
grant all on table public.game_day_zone_windows to service_role;
grant all on table public.game_day_prep_items to service_role;
grant all on table public.game_day_prep_checks to service_role;
grant all on table public.game_day_pickup_queue to service_role;

drop policy if exists game_day_zones_read on public.game_day_zones;
create policy game_day_zones_read on public.game_day_zones
  for select to anon, authenticated
  using (active = true);

drop policy if exists game_day_zones_admin on public.game_day_zones;
create policy game_day_zones_admin on public.game_day_zones
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists game_day_zone_windows_read on public.game_day_zone_windows;
create policy game_day_zone_windows_read on public.game_day_zone_windows
  for select to anon, authenticated
  using (active = true);

drop policy if exists game_day_zone_windows_admin on public.game_day_zone_windows;
create policy game_day_zone_windows_admin on public.game_day_zone_windows
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists game_day_prep_items_read on public.game_day_prep_items;
create policy game_day_prep_items_read on public.game_day_prep_items
  for select to anon, authenticated
  using (active = true);

drop policy if exists game_day_prep_items_admin on public.game_day_prep_items;
create policy game_day_prep_items_admin on public.game_day_prep_items
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists game_day_pickup_queue_read on public.game_day_pickup_queue;
create policy game_day_pickup_queue_read on public.game_day_pickup_queue
  for select to anon, authenticated
  using (true);

drop policy if exists game_day_pickup_queue_admin on public.game_day_pickup_queue;
create policy game_day_pickup_queue_admin on public.game_day_pickup_queue
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists game_day_prep_checks_own on public.game_day_prep_checks;
create policy game_day_prep_checks_own on public.game_day_prep_checks
  for all to authenticated
  using (driver_id = auth.uid())
  with check (driver_id = auth.uid());
