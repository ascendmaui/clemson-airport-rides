-- Extra Comfort retargets only to a vehicle that serves comfort.
-- service_class or tier must be comfort, matching vehicleServesComfort.
-- A boolean true service_class does not qualify. Standard and Wait & Save
-- keep the previous candidate order.

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
    and (
      lower(btrim(coalesce(t.tier::text, ''))) is distinct from 'comfort'
      or exists (
        select 1 from public.vehicles v
        where v.driver_id = ds.driver_id
          and (
            lower(btrim(coalesce(v.service_class::text, ''))) = 'comfort'
            or lower(btrim(coalesce(v.tier::text, ''))) = 'comfort'
          )
      )
    )
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
