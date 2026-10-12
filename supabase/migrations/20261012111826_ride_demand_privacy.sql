-- Close the get_ride_demand privacy leak.
--
-- get_ride_demand is SECURITY DEFINER and anon could call it, receiving
-- ~110 m pickup buckets (incl. e2e harness trips). This migration:
--   1. Redefines it to exclude e2e and QA-canceled trips (same signature).
--   2. Revokes EXECUTE from PUBLIC and anon; keeps authenticated, service_role.
--   3. Adds public_ride_demand_coarse for signed-out pages (web home, native
--      rider home before sign-in): ~1.1 km cells, cells with < 3 trips
--      suppressed, at least a 24 h lookback, e2e/QA excluded, counts only.
--
-- Rollback SQL is recorded in the PR description.

CREATE OR REPLACE FUNCTION public.get_ride_demand(
  p_from timestamptz DEFAULT (now() - '7 days'::interval),
  p_to timestamptz DEFAULT now(),
  p_hour_start integer DEFAULT NULL::integer,
  p_hour_end integer DEFAULT NULL::integer
)
RETURNS TABLE(lat double precision, lng double precision, weight numeric, request_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with pts as (
    select
      t.pickup_lat as lat,
      t.pickup_lng as lng
    from public.trips t
    left join public.profiles rp on rp.id = t.rider_id
    left join public.profiles dp on dp.id = t.driver_id
    where t.pickup_lat is not null
      and t.pickup_lng is not null
      and coalesce(t.requested_at, t.scheduled_for) >= p_from
      and coalesce(t.requested_at, t.scheduled_for) < p_to
      and coalesce(t.metadata ->> 'e2e_test', '') <> 'true'
      and t.metadata ->> 'qa_canceled' is null
      and coalesce(rp.email, '') !~* '^e2e\+[a-z0-9._-]+@clemsonrides\.com$'
      and coalesce(dp.email, '') !~* '^e2e\+[a-z0-9._-]+@clemsonrides\.com$'
      and not exists (
        select 1 from auth.users u
        where u.id in (t.rider_id, t.driver_id)
          and coalesce(u.raw_app_meta_data ->> 'e2e_test', '') = 'true'
      )
      and (
        p_hour_start is null
        or (
          extract(hour from coalesce(t.requested_at, t.scheduled_for) at time zone 'America/New_York')::int
            between least(p_hour_start, coalesce(p_hour_end, p_hour_start))
                and greatest(p_hour_start, coalesce(p_hour_end, p_hour_start))
        )
      )
  ),
  buckets as (
    select round(lat::numeric, 3) as lat, round(lng::numeric, 3) as lng, count(*)::bigint as request_count
    from pts
    group by 1, 2
  )
  select lat::float8, lng::float8, least(request_count::numeric, 20) as weight, request_count
  from buckets
  order by request_count desc;
$function$;

REVOKE ALL ON FUNCTION public.get_ride_demand(timestamptz, timestamptz, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_ride_demand(timestamptz, timestamptz, integer, integer) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.public_ride_demand_coarse(
  p_from timestamptz DEFAULT (now() - '7 days'::interval),
  p_to timestamptz DEFAULT now(),
  p_hour_start integer DEFAULT NULL::integer,
  p_hour_end integer DEFAULT NULL::integer
)
RETURNS TABLE(lat double precision, lng double precision, weight numeric, request_count bigint)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  with bounds as (
    select least(coalesce(p_from, now() - interval '7 days'), now() - interval '24 hours') as f,
           least(coalesce(p_to, now()), now()) as t
  ),
  fine as (
    select * from public.get_ride_demand((select f from bounds), (select t from bounds), p_hour_start, p_hour_end)
  ),
  coarse as (
    select round(lat::numeric, 2) as lat, round(lng::numeric, 2) as lng, sum(request_count)::bigint as request_count
    from fine
    group by 1, 2
  )
  select lat::float8, lng::float8, least(request_count::numeric, 20), request_count
  from coarse
  where request_count >= 3
  order by request_count desc;
$function$;

REVOKE ALL ON FUNCTION public.public_ride_demand_coarse(timestamptz, timestamptz, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.public_ride_demand_coarse(timestamptz, timestamptz, integer, integer) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.public_ride_demand_coarse(timestamptz, timestamptz, integer, integer) IS
  'Signed-out demand heat: ~1.1 km cells, k>=3, >=24h lookback, e2e/QA excluded, counts only.';
