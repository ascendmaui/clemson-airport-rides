-- CoS / Ops: apply this file manually (Supabase SQL editor or the migration runner).
-- This pull request does not apply it to production.
--
-- Additive pickup beacon codes.
-- Each trip receives one short code when a driver is matched (driver_id is set).
-- The code is stored in trip_pickup_codes, not as a column on trips, so a driver
-- browsing open trips cannot read it through a trips SELECT policy.
-- Row level security allows select only for that trip's rider and its matched driver.
-- Clients cannot insert, update, or delete codes. The match trigger writes the row.
--
-- Down (reversible, not applied here):
--   drop trigger if exists trips_assign_pickup_code on public.trips;
--   drop function if exists public.assign_trip_pickup_code();
--   drop function if exists public.trip_pickup_code_visible(uuid);
--   drop function if exists public.generate_pickup_code();
--   drop table if exists public.trip_pickup_codes;

create table if not exists public.trip_pickup_codes (
  trip_id uuid primary key references public.trips (id) on delete cascade,
  code text not null,
  created_at timestamptz not null default now(),
  constraint trip_pickup_codes_code_chk
    check (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{2,3}$')
);

comment on table public.trip_pickup_codes is
  'Short pickup beacon code for one trip. Readable only by that trip''s rider and matched driver.';

comment on column public.trip_pickup_codes.code is
  '2-3 unambiguous characters. Alphabet omits O, 0, I, and 1.';

alter table public.trip_pickup_codes enable row level security;

revoke all on table public.trip_pickup_codes from public, anon, authenticated;
grant select on table public.trip_pickup_codes to authenticated;

-- Boolean only. Does not return the code. row_security off so a broad trips
-- SELECT policy cannot widen who may read the code.
create or replace function public.trip_pickup_code_visible(p_trip_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
set row_security = off
as $$
  select exists (
    select 1
    from public.trips t
    where t.id = p_trip_id
      and t.driver_id is not null
      and auth.uid() is not null
      and (t.rider_id = auth.uid() or t.driver_id = auth.uid())
  );
$$;

revoke all on function public.trip_pickup_code_visible(uuid) from public, anon;
grant execute on function public.trip_pickup_code_visible(uuid) to authenticated;

drop policy if exists trip_pickup_codes_select_party on public.trip_pickup_codes;
create policy trip_pickup_codes_select_party
  on public.trip_pickup_codes
  for select
  to authenticated
  using (public.trip_pickup_code_visible(trip_id));

-- 32-character alphabet: A-Z and 2-9, without O, 0, I, or 1.
create or replace function public.generate_pickup_code()
returns text
language plpgsql
volatile
set search_path = public
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i integer;
  n integer;
begin
  for i in 1..3 loop
    n := 1 + floor(random() * length(alphabet))::integer;
    if n < 1 then
      n := 1;
    end if;
    if n > length(alphabet) then
      n := length(alphabet);
    end if;
    out := out || substr(alphabet, n, 1);
  end loop;
  return out;
end;
$$;

revoke all on function public.generate_pickup_code() from public, anon, authenticated;

create or replace function public.assign_trip_pickup_code()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.driver_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.driver_id is not distinct from new.driver_id then
    return new;
  end if;
  insert into public.trip_pickup_codes (trip_id, code)
  values (new.id, public.generate_pickup_code())
  on conflict (trip_id) do nothing;
  return new;
end;
$$;

revoke all on function public.assign_trip_pickup_code() from public, anon, authenticated;

drop trigger if exists trips_assign_pickup_code on public.trips;
create trigger trips_assign_pickup_code
  after insert or update of driver_id on public.trips
  for each row
  execute function public.assign_trip_pickup_code();

-- Trips already matched before this file is applied still need a code.
insert into public.trip_pickup_codes (trip_id, code)
select t.id, public.generate_pickup_code()
from public.trips t
where t.driver_id is not null
  and not exists (
    select 1 from public.trip_pickup_codes c where c.trip_id = t.id
  );
