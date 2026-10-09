-- Optional women-only comfort matching.
-- gender_identity is self-identified and is not returned on public driver cards.
-- women_only_matching may be true only for a woman. Matching reads both sides:
-- a woman rider with the preference is offered women drivers, and a woman driver
-- with the preference is offered women passengers.

alter table public.profiles
  add column if not exists gender_identity text not null default 'unspecified',
  add column if not exists women_only_matching boolean not null default false;

alter table public.profiles drop constraint if exists profiles_gender_identity_check;
alter table public.profiles
  add constraint profiles_gender_identity_check
  check (gender_identity in ('woman', 'man', 'nonbinary', 'unspecified'));

alter table public.profiles drop constraint if exists profiles_women_only_requires_woman;
alter table public.profiles
  add constraint profiles_women_only_requires_woman
  check (women_only_matching = false or gender_identity = 'woman');

comment on column public.profiles.gender_identity is
  'Self-identified gender used only for the optional women-only comfort preference. Not shown on public driver cards.';
comment on column public.profiles.women_only_matching is
  'When true, a woman rider is matched only with women drivers, or a woman driver only with women passengers.';

create or replace function public.women_only_pair_allowed(p_rider uuid, p_driver uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  rider_gender text := 'unspecified';
  driver_gender text := 'unspecified';
  rider_wants boolean := false;
  driver_wants boolean := false;
begin
  if p_rider is null or p_driver is null then
    return true;
  end if;
  select coalesce(gender_identity, 'unspecified'), coalesce(women_only_matching, false)
    into rider_gender, rider_wants
  from public.profiles
  where id = p_rider;
  select coalesce(gender_identity, 'unspecified'), coalesce(women_only_matching, false)
    into driver_gender, driver_wants
  from public.profiles
  where id = p_driver;
  if rider_wants and rider_gender = 'woman' and driver_gender is distinct from 'woman' then
    return false;
  end if;
  if driver_wants and driver_gender = 'woman' and rider_gender is distinct from 'woman' then
    return false;
  end if;
  return true;
end;
$$;

revoke all on function public.women_only_pair_allowed(uuid, uuid) from public;

create or replace function public.women_only_visible_trips(trip_ids uuid[])
returns setof uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  actor uuid;
begin
  actor := auth.uid();
  if actor is null or trip_ids is null then
    return;
  end if;
  return query
    select t.id
    from public.trips t
    where t.id = any(trip_ids)
      and public.women_only_pair_allowed(t.rider_id, actor);
end;
$$;

revoke all on function public.women_only_visible_trips(uuid[]) from public;

-- Same retarget as 20261004160000, plus the comfort preference on the next driver.
create or replace function public.release_matching_offer(p_trip uuid, p_driver uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare
  t public.trips;
  candidate uuid;
  skipped jsonb;
begin
  select * into t from public.trips where id = p_trip for update;
  if t.id is null or t.status::text not in ('searching', 'offered')
     or t.driver_id is not null or t.pickup_at is not null or t.scheduled_for is not null
     or coalesce(t.deposit_cents, 0) <> 0
     or t.metadata->>'kind' is distinct from 'driver_request' then return; end if;
  if nullif(t.metadata->>'offer_driver_id', '') is distinct from p_driver::text then return; end if;
  skipped := coalesce(t.metadata->'offer_passed_driver_ids', '[]'::jsonb);
  if not skipped ? p_driver::text then skipped := skipped || to_jsonb(p_driver::text); end if;
  select ds.driver_id into candidate
  from public.driver_status ds
  join public.profiles p on p.id = ds.driver_id
  where ds.online is true and ds.driver_id <> p_driver
    and ds.driver_id is distinct from t.rider_id
    and not skipped ? ds.driver_id::text
    and not coalesce(t.metadata->'offer_tried_driver_ids', '[]'::jsonb) ? ds.driver_id::text
    and not exists (select 1 from public.driver_offer_passes op where op.trip_id = t.id and op.driver_id = ds.driver_id)
    and public.women_only_pair_allowed(t.rider_id, ds.driver_id)
    and (exists (select 1 from public.driver_applications da where da.profile_id = ds.driver_id and da.onboarding_status = 'approved')
      or p.is_admin is true or p.role::text in ('admin', 'ops')
      or lower(p.email) in ('johnmatveyev@gmail.com', 'ascendmaui@gmail.com', 'jmat2019@icloud.com')
      or exists (select 1 from public.admin_users a where a.email = lower(p.email) and a.access_role in ('admin', 'support')))
  order by coalesce((select ord from jsonb_array_elements_text(coalesce(t.metadata->'auto_assign_queue', '[]'::jsonb)) with ordinality q(id, ord) where q.id = ds.driver_id::text limit 1), 2147483647),
    case lower(p.email) when 'johnmatveyev@gmail.com' then 0 when 'kimubermaui@gmail.com' then 1 else 2 end, ds.driver_id
  limit 1 for update of ds skip locked;
  update public.trips set status = 'searching', metadata = t.metadata || jsonb_build_object(
    'offer_driver_id', candidate, 'match', case when candidate is null then 'open' else 'auto' end,
    'offer_passed_driver_ids', skipped,
    'offer_tried_driver_ids', coalesce(t.metadata->'offer_tried_driver_ids', '[]'::jsonb) || to_jsonb(p_driver::text), 'offer_release_reason', p_reason, 'offer_released_at', now())
  where id = t.id and driver_id is null and status::text in ('searching', 'offered');
end;
$$;

revoke all on function public.release_matching_offer(uuid, uuid, text) from public;

create or replace function public.guard_women_only_assignment()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  kind text;
begin
  if new.driver_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and old.driver_id is not distinct from new.driver_id then
    return new;
  end if;
  kind := coalesce(new.metadata->>'kind', '');
  -- Chosen carpool and friend-ride organizers are not open matching.
  if tg_op = 'INSERT' and kind in ('carpool', 'friend_ride') then
    return new;
  end if;
  if not public.women_only_pair_allowed(new.rider_id, new.driver_id) then
    raise exception 'This ride uses a women-only comfort preference that does not match.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.guard_women_only_assignment() from public;

drop trigger if exists trips_guard_women_only_assignment on public.trips;
create trigger trips_guard_women_only_assignment
  before insert or update on public.trips
  for each row
  execute function public.guard_women_only_assignment();

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    grant execute on function public.women_only_pair_allowed(uuid, uuid) to authenticated;
    grant execute on function public.women_only_visible_trips(uuid[]) to authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.women_only_pair_allowed(uuid, uuid) to service_role;
    grant execute on function public.women_only_visible_trips(uuid[]) to service_role;
  end if;
end $$;
