-- Driver safety score inputs. Additive: a speed-sample history fed by a
-- trigger on trip_driver_locations (which only keeps the latest point), and a
-- config row. The trigger never blocks the location write.

create table if not exists public.driver_speed_samples (
  id bigint generated always as identity primary key,
  driver_id uuid not null,
  trip_id uuid not null,
  speed_mps double precision not null,
  lat double precision,
  lng double precision,
  recorded_at timestamptz not null default now()
);
create index if not exists driver_speed_samples_driver_time on public.driver_speed_samples (driver_id, recorded_at desc);
alter table public.driver_speed_samples enable row level security;
drop policy if exists driver_speed_samples_own on public.driver_speed_samples;
create policy driver_speed_samples_own on public.driver_speed_samples
  for select to authenticated using (driver_id = auth.uid());
revoke all on public.driver_speed_samples from public, anon;
grant select on public.driver_speed_samples to authenticated;
grant all on public.driver_speed_samples to service_role;

create or replace function private.record_driver_speed_sample()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.speed is not null and new.speed >= 0 and new.driver_id is not null then
    insert into public.driver_speed_samples (driver_id, trip_id, speed_mps, lat, lng, recorded_at)
    values (new.driver_id, new.trip_id, new.speed, new.lat, new.lng, coalesce(new.updated_at, now()));
  end if;
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.record_driver_speed_sample() from public;

drop trigger if exists trip_driver_locations_speed_sample on public.trip_driver_locations;
create trigger trip_driver_locations_speed_sample
  after insert or update of lat, lng, speed on public.trip_driver_locations
  for each row execute function private.record_driver_speed_sample();

insert into public.driver_perk_config (key, value)
values ('safety_score', jsonb_build_object(
  'enabled', true, 'affectsDispatch', false, 'windowDays', 30,
  'hardBrakeMps2', 3.4, 'maxGapSeconds', 10, 'speedingMps', 31.3))
on conflict (key) do nothing;
