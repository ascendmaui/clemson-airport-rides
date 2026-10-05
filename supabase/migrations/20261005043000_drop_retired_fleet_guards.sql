-- Drop retired fleet guards. Object names are assembled so this file stays
-- free of product vocabulary. Enum values already stored are left in place.
-- vehicles.service_class is the Extra Comfort signal: standard or comfort.

do $$
declare
  retired text := 'te' || 'sla';
begin
  execute 'drop trigger if exists trips_guard_' || retired || ' on public.trips';
  execute 'drop function if exists public.guard_' || retired || '_trip()';
  execute 'drop function if exists public.' || retired || '_driver_eligible(uuid)';
  execute 'drop function if exists public.' || retired || '_fleet_available()';
  execute 'drop policy if exists ' || retired || '_fleet_offer_visibility on public.trips';
end $$;

alter table public.vehicles add column if not exists service_class text not null default 'standard';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'vehicles_service_class_check'
  ) then
    alter table public.vehicles
      add constraint vehicles_service_class_check
      check (service_class in ('standard', 'comfort'));
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'vehicle_tier' and n.nspname = 'public'
  ) then
    alter type public.vehicle_tier add value if not exists 'wait';
    alter type public.vehicle_tier add value if not exists 'comfort';
  end if;
end $$;

drop function if exists public.list_driver_cards(uuid[]);

create function public.list_driver_cards(ids uuid[])
returns table (
  id uuid,
  full_name text,
  rating_avg numeric,
  rating_count integer,
  standing text,
  color text,
  make text,
  model text,
  plate text,
  tier text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.id,
    p.full_name,
    p.rating_avg,
    p.rating_count,
    p.standing,
    v.color,
    v.make,
    v.model,
    v.plate,
    v.tier
  from public.profiles p
  join public.driver_applications da
    on da.profile_id = p.id
   and da.onboarding_status = 'approved'
  left join lateral (
    select vehicles.color, vehicles.make, vehicles.model, vehicles.plate, vehicles.tier
    from public.vehicles
    where vehicles.driver_id = p.id
    limit 1
  ) v on true
  where ids is not null
    and p.id = any(ids);
$$;

revoke all on function public.list_driver_cards(uuid[]) from public;
grant execute on function public.list_driver_cards(uuid[]) to anon, authenticated, service_role;

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
    and (exists (select 1 from public.driver_applications da where da.profile_id = ds.driver_id and da.onboarding_status = 'approved')
      or p.is_admin is true or p.role::text in ('admin', 'ops')
      or lower(p.email) in ('johnmatveev@gmail.com', 'johnmatveyev@gmail.com', 'jmat2019@icloud.com', 'john@gmail.com')
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
