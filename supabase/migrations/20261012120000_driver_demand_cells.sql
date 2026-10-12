-- Driver demand heat: server-side grid aggregation for the Tiger Heat map.
--
-- Returns counts per ~280 m grid cell only. Cell centers are snapped to the
-- grid, so no rider identity, trip id, or exact pickup address leaves the
-- database. Callable by drivers and admins (is_driver_or_admin_role); anon
-- has no execute grant. Other callers get zero rows.
--
-- Signals, each decayed with a half-life of half the window:
--   request   searching / offered trips (live asks), weight 1.0
--   pickup    recent pickups (pickup_at, else completed_at), weight 0.6
--   scheduled pickups due within the horizon, weight 0.5 rising to 1.0 as
--             the pickup time nears
--   airport   any of the above tied to a flight or airport trip gets x1.5
--             (x2 in peak mode)
-- Peak mode (game days, airport rushes) widens the window to 30 minutes and
-- the scheduled horizon to 120 minutes.
--
-- Excluded: e2e harness trips (metadata.e2e_test, e2e+…@clemsonrides.com
-- rider or driver, auth app_metadata.e2e_test), QA-canceled trips. Demo map
-- cars and the busy roster are client-only and never reach trips.
--
-- Additive: new function and one index. Surge zones can reuse this RPC.

CREATE INDEX IF NOT EXISTS trips_demand_status_created_idx
  ON public.trips (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.driver_demand_cells(
  p_window_minutes integer DEFAULT 20,
  p_peak boolean DEFAULT false
)
RETURNS TABLE (
  cell_id text,
  lat double precision,
  lng double precision,
  demand numeric,
  requests integer,
  pickups integer,
  scheduled integer,
  airport integer,
  window_minutes integer,
  generated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  WITH params AS (
    SELECT
      CASE WHEN coalesce(p_peak, false) THEN 30
           ELSE greatest(10, least(coalesce(p_window_minutes, 20), 30)) END AS w,
      CASE WHEN coalesce(p_peak, false) THEN 120 ELSE 60 END AS horizon,
      CASE WHEN coalesce(p_peak, false) THEN 2.0 ELSE 1.5 END AS air_mult,
      now() AS t0,
      0.0025::float8 AS dlat,
      0.003::float8 AS dlng
  ),
  allowed AS (
    SELECT 1 AS ok WHERE public.is_driver_or_admin_role()
  ),
  base AS (
    SELECT
      t.pickup_lat AS plat,
      t.pickup_lng AS plng,
      t.status::text AS status,
      coalesce(t.requested_at, t.created_at) AS asked_at,
      coalesce(t.pickup_at, t.completed_at) AS picked_at,
      t.scheduled_for,
      (t.flight IS NOT NULL AND btrim(t.flight) <> '')
        OR coalesce(t.metadata ->> 'airport', '') NOT IN ('', 'false', 'null') AS is_air
    FROM public.trips t
    LEFT JOIN public.profiles rp ON rp.id = t.rider_id
    LEFT JOIN public.profiles dp ON dp.id = t.driver_id
    WHERE EXISTS (SELECT 1 FROM allowed)
      AND t.pickup_lat IS NOT NULL
      AND t.pickup_lng IS NOT NULL
      AND t.pickup_lat BETWEEN -90 AND 90
      AND t.pickup_lng BETWEEN -180 AND 180
      AND coalesce(t.metadata ->> 'e2e_test', '') <> 'true'
      AND t.metadata ->> 'qa_canceled' IS NULL
      AND coalesce(rp.email, '') !~* '^e2e\+[a-z0-9._-]+@clemsonrides\.com$'
      AND coalesce(dp.email, '') !~* '^e2e\+[a-z0-9._-]+@clemsonrides\.com$'
      AND NOT EXISTS (
        SELECT 1 FROM auth.users u
        WHERE u.id IN (t.rider_id, t.driver_id)
          AND coalesce(u.raw_app_meta_data ->> 'e2e_test', '') = 'true'
      )
  ),
  events AS (
    SELECT b.plat, b.plng, b.is_air, 'request'::text AS kind,
           1.0 * exp(-ln(2) * extract(epoch FROM (p.t0 - b.asked_at)) / 60.0 / (p.w / 2.0)) AS wt
    FROM base b, params p
    WHERE b.status IN ('searching', 'offered')
      AND b.asked_at >= p.t0 - make_interval(mins => p.w)
      AND b.asked_at <= p.t0 + interval '1 minute'
    UNION ALL
    SELECT b.plat, b.plng, b.is_air, 'pickup',
           0.6 * exp(-ln(2) * extract(epoch FROM (p.t0 - b.picked_at)) / 60.0 / (p.w / 2.0))
    FROM base b, params p
    WHERE b.status IN ('arrived', 'in_progress', 'completed')
      AND b.picked_at >= p.t0 - make_interval(mins => p.w)
      AND b.picked_at <= p.t0 + interval '1 minute'
    UNION ALL
    SELECT b.plat, b.plng, b.is_air, 'scheduled',
           0.5 + 0.5 * (1 - extract(epoch FROM (b.scheduled_for - p.t0)) / 60.0 / p.horizon)
    FROM base b, params p
    WHERE b.status IN ('scheduled', 'accepted')
      AND b.scheduled_for >= p.t0
      AND b.scheduled_for <= p.t0 + make_interval(mins => p.horizon)
  ),
  cells AS (
    SELECT
      floor(e.plat / p.dlat)::bigint AS r,
      floor(e.plng / p.dlng)::bigint AS c,
      sum(e.wt * CASE WHEN e.is_air THEN p.air_mult ELSE 1 END) AS demand,
      count(*) FILTER (WHERE e.kind = 'request')::int AS requests,
      count(*) FILTER (WHERE e.kind = 'pickup')::int AS pickups,
      count(*) FILTER (WHERE e.kind = 'scheduled')::int AS scheduled,
      count(*) FILTER (WHERE e.is_air)::int AS airport
    FROM events e, params p
    GROUP BY 1, 2
  )
  SELECT
    'g' || c.r || '_' || c.c,
    ((c.r + 0.5) * p.dlat)::float8,
    ((c.c + 0.5) * p.dlng)::float8,
    round(c.demand::numeric, 3),
    c.requests,
    c.pickups,
    c.scheduled,
    c.airport,
    p.w,
    p.t0
  FROM cells c, params p
  WHERE c.demand > 0
  ORDER BY c.demand DESC
  LIMIT 60;
$function$;

REVOKE ALL ON FUNCTION public.driver_demand_cells(integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.driver_demand_cells(integer, boolean) TO authenticated, service_role;

COMMENT ON FUNCTION public.driver_demand_cells(integer, boolean) IS
  'Tiger Heat demand grid for drivers: decayed counts per ~280 m cell, no identities. Reusable for surge zones.';
