-- Driver year-end mileage log and the configured IRS business mileage rates
-- used only to estimate a deduction. Drivers can read their own log rows.
-- Stripe 1099 forms are not stored here.
--
-- Down (reversible):
--   drop trigger if exists trips_driver_mileage_log on public.trips;
--   drop function if exists public.sync_driver_mileage_log();
--   drop function if exists public.driver_trip_mileage(text, jsonb, double precision, double precision, double precision, double precision, double precision, double precision, boolean);
--   drop table if exists public.driver_mileage_logs;
--   drop table if exists public.driver_mileage_rates;

create table if not exists public.driver_mileage_rates (
  id uuid primary key default gen_random_uuid(),
  tax_year integer not null,
  starts_on date not null unique,
  ends_on date not null,
  cents_per_mile numeric(6,2) not null check (cents_per_mile >= 0 and cents_per_mile <= 1000),
  label text not null,
  source_note text,
  updated_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

comment on table public.driver_mileage_rates is
  'Configured IRS business standard mileage rates. Used only to label an estimated deduction. Not tax advice.';

insert into public.driver_mileage_rates (tax_year, starts_on, ends_on, cents_per_mile, label, source_note)
values
  (2024, '2024-01-01', '2024-12-31', 67, 'IRS business standard mileage rate', 'IR-2023-239'),
  (2025, '2025-01-01', '2025-12-31', 70, 'IRS business standard mileage rate', 'IR-2024-312'),
  (2026, '2026-01-01', '2026-06-30', 72.5, 'IRS business standard mileage rate', 'Notice 2026-10'),
  (2026, '2026-07-01', '2026-12-31', 76, 'IRS business standard mileage rate', 'Announcement 2026-11')
on conflict (starts_on) do nothing;

alter table public.driver_mileage_rates enable row level security;

drop policy if exists driver_mileage_rates_read on public.driver_mileage_rates;
create policy driver_mileage_rates_read
on public.driver_mileage_rates
for select
to authenticated
using (true);

create table if not exists public.driver_mileage_logs (
  id uuid primary key default gen_random_uuid(),
  driver_id uuid not null references public.profiles(id) on delete cascade,
  trip_id uuid not null references public.trips(id) on delete cascade,
  tax_year integer not null,
  completed_at timestamptz,
  on_trip_miles numeric(10,2),
  on_trip_source text not null default 'unavailable',
  enroute_miles numeric(10,2),
  enroute_source text not null default 'unavailable',
  deductible_miles numeric(10,2) not null default 0,
  pickup_label text,
  dropoff_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (driver_id, trip_id),
  constraint driver_mileage_logs_on_trip_source check (on_trip_source in ('routed', 'straight_line', 'unavailable')),
  constraint driver_mileage_logs_enroute_source check (enroute_source in ('routed', 'straight_line', 'unavailable')),
  constraint driver_mileage_logs_miles_nonneg check (
    (on_trip_miles is null or on_trip_miles >= 0)
    and (enroute_miles is null or enroute_miles >= 0)
    and deductible_miles >= 0
  )
);

comment on table public.driver_mileage_logs is
  'Per-trip on-trip and en-route miles for the signed-in driver. A records log, not a tax determination.';

create index if not exists driver_mileage_logs_driver_year_idx
  on public.driver_mileage_logs (driver_id, tax_year, completed_at desc);

alter table public.driver_mileage_logs enable row level security;

drop policy if exists driver_mileage_logs_select_own on public.driver_mileage_logs;
create policy driver_mileage_logs_select_own
on public.driver_mileage_logs
for select
to authenticated
using (driver_id = auth.uid());

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on public.driver_mileage_logs from anon;
    revoke all on public.driver_mileage_rates from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on public.driver_mileage_logs from authenticated;
    revoke all on public.driver_mileage_rates from authenticated;
    grant select on public.driver_mileage_logs to authenticated;
    grant select on public.driver_mileage_rates to authenticated;
  end if;
end $$;

create or replace function public.driver_trip_mileage(
  p_status text,
  p_metadata jsonb,
  p_pickup_lat double precision,
  p_pickup_lng double precision,
  p_dropoff_lat double precision,
  p_dropoff_lng double precision,
  p_driver_lat double precision,
  p_driver_lng double precision,
  p_capture_enroute boolean
) returns jsonb
language plpgsql
immutable
set search_path = public, pg_temp
as $$
declare
  meta jsonb := coalesce(p_metadata, '{}'::jsonb);
  on_meters double precision;
  en_meters double precision;
  on_miles numeric;
  en_miles numeric;
  on_source text := 'unavailable';
  en_source text := 'unavailable';
  straight double precision;
  key text;
  raw text;
  parsed double precision;
begin
  if p_status = 'completed' then
    foreach key in array array['route_distance_m', 'distance_m'] loop
      raw := meta ->> key;
      if raw is not null and raw <> '' then
        begin
          parsed := raw::double precision;
          if parsed > 0 then
            on_meters := parsed;
            on_source := 'routed';
            exit;
          end if;
        exception when others then
          null;
        end;
      end if;
    end loop;
    if on_source = 'unavailable'
       and p_pickup_lat between -90 and 90 and p_dropoff_lat between -90 and 90
       and p_pickup_lng between -180 and 180 and p_dropoff_lng between -180 and 180 then
      straight := 6371000 * 2 * asin(least(1, sqrt(
        power(sin(radians(p_dropoff_lat - p_pickup_lat) / 2), 2)
        + cos(radians(p_pickup_lat)) * cos(radians(p_dropoff_lat))
          * power(sin(radians(p_dropoff_lng - p_pickup_lng) / 2), 2)
      )));
      if straight > 0 then
        on_meters := straight;
        on_source := 'straight_line';
      end if;
    end if;
  end if;

  foreach key in array array['enroute_distance_m', 'pickup_route_distance_m', 'en_route_distance_m'] loop
    raw := meta ->> key;
    if raw is not null and raw <> '' then
      begin
        parsed := raw::double precision;
        if parsed > 0 then
          en_meters := parsed;
          en_source := 'routed';
          exit;
        end if;
      exception when others then
        null;
      end;
    end if;
  end loop;

  if en_source = 'unavailable' and p_capture_enroute
     and p_driver_lat between -90 and 90 and p_pickup_lat between -90 and 90
     and p_driver_lng between -180 and 180 and p_pickup_lng between -180 and 180 then
    straight := 6371000 * 2 * asin(least(1, sqrt(
      power(sin(radians(p_pickup_lat - p_driver_lat) / 2), 2)
      + cos(radians(p_driver_lat)) * cos(radians(p_pickup_lat))
        * power(sin(radians(p_pickup_lng - p_driver_lng) / 2), 2)
    )));
    if straight > 0 then
      en_meters := straight;
      en_source := 'straight_line';
    end if;
  end if;

  if on_meters is not null then
    on_miles := round((on_meters / 1609.344)::numeric, 2);
    if on_miles <= 0 then
      on_miles := null;
      on_source := 'unavailable';
    end if;
  end if;
  if en_meters is not null then
    en_miles := round((en_meters / 1609.344)::numeric, 2);
    if en_miles <= 0 then
      en_miles := null;
      en_source := 'unavailable';
    end if;
  end if;

  return jsonb_build_object(
    'on_trip_miles', on_miles,
    'on_trip_source', on_source,
    'enroute_miles', en_miles,
    'enroute_source', en_source,
    'deductible_miles', round((coalesce(on_miles, 0) + coalesce(en_miles, 0))::numeric, 2)
  );
end;
$$;

create or replace function public.sync_driver_mileage_log()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  capture boolean := false;
  lat double precision;
  lng double precision;
  calc jsonb;
  on_miles numeric;
  en_miles numeric;
  on_source text;
  en_source text;
  when_at timestamptz;
  yr integer;
begin
  if new.driver_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and new.status::text in ('canceled', 'cancelled')
     and old.status::text is distinct from new.status::text then
    update public.driver_mileage_logs
      set on_trip_miles = null,
          on_trip_source = 'unavailable',
          enroute_miles = null,
          enroute_source = 'unavailable',
          deductible_miles = 0,
          updated_at = now()
      where trip_id = new.id and driver_id = new.driver_id;
    return new;
  end if;

  if (tg_op = 'INSERT' and new.status::text in ('accepted', 'arriving'))
     or (tg_op = 'UPDATE'
         and new.status::text in ('accepted', 'arriving')
         and old.status::text is distinct from new.status::text
         and old.status::text in ('searching', 'offered', 'scheduled', 'requested', 'matched')) then
    capture := true;
    begin
      select ds.lat, ds.lng into lat, lng
      from public.driver_status ds
      where ds.driver_id = new.driver_id;
    exception when undefined_table then
      lat := null;
      lng := null;
    end;
  end if;

  if not capture and new.status::text not in ('completed', 'cancelled_wait') then
    return new;
  end if;

  if capture and new.status::text not in ('completed', 'cancelled_wait') then
    calc := public.driver_trip_mileage(
      'accepted', new.metadata, new.pickup_lat, new.pickup_lng, new.dropoff_lat, new.dropoff_lng, lat, lng, true
    );
  else
    calc := public.driver_trip_mileage(
      new.status::text, new.metadata, new.pickup_lat, new.pickup_lng, new.dropoff_lat, new.dropoff_lng, null, null, false
    );
  end if;

  on_miles := nullif(calc->>'on_trip_miles', '')::numeric;
  en_miles := nullif(calc->>'enroute_miles', '')::numeric;
  on_source := coalesce(calc->>'on_trip_source', 'unavailable');
  en_source := coalesce(calc->>'enroute_source', 'unavailable');
  when_at := coalesce(new.completed_at, new.canceled_at, now());
  yr := extract(year from when_at at time zone 'America/New_York')::integer;

  insert into public.driver_mileage_logs (
    driver_id, trip_id, tax_year, completed_at,
    on_trip_miles, on_trip_source, enroute_miles, enroute_source, deductible_miles,
    pickup_label, dropoff_label, updated_at
  ) values (
    new.driver_id, new.id, yr, when_at,
    on_miles, on_source, en_miles, en_source,
    round((coalesce(on_miles, 0) + coalesce(en_miles, 0))::numeric, 2),
    left(coalesce(new.pickup_label, ''), 180),
    left(coalesce(new.dropoff_label, ''), 180),
    now()
  )
  on conflict (driver_id, trip_id) do update set
    tax_year = excluded.tax_year,
    completed_at = excluded.completed_at,
    on_trip_miles = case
      when driver_mileage_logs.on_trip_source = 'routed' and excluded.on_trip_source is distinct from 'routed' then driver_mileage_logs.on_trip_miles
      when excluded.on_trip_source = 'unavailable' and driver_mileage_logs.on_trip_source is distinct from 'unavailable' then driver_mileage_logs.on_trip_miles
      else excluded.on_trip_miles
    end,
    on_trip_source = case
      when driver_mileage_logs.on_trip_source = 'routed' and excluded.on_trip_source is distinct from 'routed' then driver_mileage_logs.on_trip_source
      when excluded.on_trip_source = 'unavailable' and driver_mileage_logs.on_trip_source is distinct from 'unavailable' then driver_mileage_logs.on_trip_source
      else excluded.on_trip_source
    end,
    enroute_miles = case
      when driver_mileage_logs.enroute_source = 'routed' and excluded.enroute_source is distinct from 'routed' then driver_mileage_logs.enroute_miles
      when excluded.enroute_source = 'unavailable' and driver_mileage_logs.enroute_source is distinct from 'unavailable' then driver_mileage_logs.enroute_miles
      else excluded.enroute_miles
    end,
    enroute_source = case
      when driver_mileage_logs.enroute_source = 'routed' and excluded.enroute_source is distinct from 'routed' then driver_mileage_logs.enroute_source
      when excluded.enroute_source = 'unavailable' and driver_mileage_logs.enroute_source is distinct from 'unavailable' then driver_mileage_logs.enroute_source
      else excluded.enroute_source
    end,
    pickup_label = coalesce(nullif(excluded.pickup_label, ''), driver_mileage_logs.pickup_label),
    dropoff_label = coalesce(nullif(excluded.dropoff_label, ''), driver_mileage_logs.dropoff_label),
    updated_at = now(),
    deductible_miles = round((
      coalesce(case
        when driver_mileage_logs.on_trip_source = 'routed' and excluded.on_trip_source is distinct from 'routed' then driver_mileage_logs.on_trip_miles
        when excluded.on_trip_source = 'unavailable' and driver_mileage_logs.on_trip_source is distinct from 'unavailable' then driver_mileage_logs.on_trip_miles
        else excluded.on_trip_miles
      end, 0)
      + coalesce(case
        when driver_mileage_logs.enroute_source = 'routed' and excluded.enroute_source is distinct from 'routed' then driver_mileage_logs.enroute_miles
        when excluded.enroute_source = 'unavailable' and driver_mileage_logs.enroute_source is distinct from 'unavailable' then driver_mileage_logs.enroute_miles
        else excluded.enroute_miles
      end, 0)
    )::numeric, 2);
  return new;
end;
$$;

revoke all on function public.driver_trip_mileage(text, jsonb, double precision, double precision, double precision, double precision, double precision, double precision, boolean) from public;
revoke all on function public.sync_driver_mileage_log() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke all on function public.driver_trip_mileage(text, jsonb, double precision, double precision, double precision, double precision, double precision, double precision, boolean) from anon;
    revoke all on function public.sync_driver_mileage_log() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke all on function public.driver_trip_mileage(text, jsonb, double precision, double precision, double precision, double precision, double precision, double precision, boolean) from authenticated;
    revoke all on function public.sync_driver_mileage_log() from authenticated;
  end if;
end $$;

drop trigger if exists trips_driver_mileage_log on public.trips;
create trigger trips_driver_mileage_log
after insert or update of status, driver_id, metadata, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, completed_at, pickup_label, dropoff_label
on public.trips
for each row
execute function public.sync_driver_mileage_log();

insert into public.driver_mileage_logs (
  driver_id, trip_id, tax_year, completed_at,
  on_trip_miles, on_trip_source, enroute_miles, enroute_source, deductible_miles,
  pickup_label, dropoff_label
)
select
  t.driver_id,
  t.id,
  extract(year from coalesce(t.completed_at, t.canceled_at, now()) at time zone 'America/New_York')::integer,
  coalesce(t.completed_at, t.canceled_at, now()),
  (mileage.calc->>'on_trip_miles')::numeric,
  coalesce(mileage.calc->>'on_trip_source', 'unavailable'),
  (mileage.calc->>'enroute_miles')::numeric,
  coalesce(mileage.calc->>'enroute_source', 'unavailable'),
  coalesce((mileage.calc->>'deductible_miles')::numeric, 0),
  left(coalesce(t.pickup_label, ''), 180),
  left(coalesce(t.dropoff_label, ''), 180)
from public.trips t
cross join lateral (
  select public.driver_trip_mileage(
    t.status::text, t.metadata, t.pickup_lat, t.pickup_lng, t.dropoff_lat, t.dropoff_lng, null, null, false
  ) as calc
) mileage
where t.driver_id is not null
  and t.status::text in ('completed', 'cancelled_wait')
on conflict (driver_id, trip_id) do nothing;
