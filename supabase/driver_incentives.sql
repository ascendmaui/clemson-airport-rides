-- Driver incentives (busy nights + Clemson game days).
-- Applied via Supabase MCP apply_migration name=driver_incentives
-- Project: awktabuhijrshmsmagpq
--
-- Rider surge vs driver incentive
--   game_day_events.surge_multiplier  → rider-facing fare (unchanged here)
--   driver_incentives type=multiplier → boost on the driver's net share
--   They can both be 1.5 at the same time and do not multiply each other.
--
-- Platform split written onto driver_earnings at trip complete:
--   platform_fee_cents = round(trips.fare_cents * 20 / 100)
--   driver_net_cents   = fare_cents - platform_fee_cents
--   incentive extra is added ON TOP of driver_net (basis = driver_net).
--   The rider is not charged the incentive. The platform does not take 20% of it.
--
-- Default windows (America/New_York, 19:00–02:00, midnight wraps to the previous night):
--   Thursday night  multiplier 1.5
--   Friday night    multiplier 1.5
--   Saturday night  multiplier 1.5
--   Clemson game day  bonus_per_ride 500 cents ($5) while game_day_events overlaps
--                     or while an admin row with start/end and no weekdays is in range
--
-- Tracking (SQL-friendly):
--   incentive_payouts     one row per incentive per completed trip (extra_cents)
--   incentive_presence    drivers online who saw the window (participation)
--   driver_earnings       one row per trip: net + incentive extra
--   incentive_effectiveness  service-role report view

CREATE TABLE IF NOT EXISTS public.driver_incentives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,
  value numeric(12, 4) NOT NULL,
  starts_at timestamptz,
  ends_at timestamptz,
  days_of_week integer[] NOT NULL DEFAULT '{}',
  game_day boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  night_start time NOT NULL DEFAULT '19:00',
  night_end time NOT NULL DEFAULT '02:00',
  timezone text NOT NULL DEFAULT 'America/New_York',
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_incentives_type_check CHECK (
    type = ANY (ARRAY['bonus_per_ride'::text, 'hourly_guarantee'::text, 'multiplier'::text])
  ),
  CONSTRAINT driver_incentives_value_check CHECK (
    value >= 0 AND (type <> 'multiplier' OR value >= 1)
  ),
  CONSTRAINT driver_incentives_dow_check CHECK (
    days_of_week <@ ARRAY[0, 1, 2, 3, 4, 5, 6]::integer[]
  ),
  CONSTRAINT driver_incentives_window_check CHECK (
    starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at
  )
);

COMMENT ON TABLE public.driver_incentives IS
  'Driver pay incentives. type=multiplier boosts driver net, not rider fare. Distinct from game_day_events.surge_multiplier (rider surge).';
COMMENT ON COLUMN public.driver_incentives.type IS
  'bonus_per_ride (value = cents) | hourly_guarantee (value = cents per hour) | multiplier (value = factor on driver net, e.g. 1.5)';
COMMENT ON COLUMN public.driver_incentives.value IS
  'multiplier: factor on driver_net. bonus_per_ride: cents. hourly_guarantee: cents per hour.';
COMMENT ON COLUMN public.driver_incentives.game_day IS
  'When true, window is also on while a game_day_events row overlaps now. Does not copy surge_multiplier.';

CREATE TABLE IF NOT EXISTS public.incentive_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incentive_id uuid NOT NULL REFERENCES public.driver_incentives(id) ON DELETE RESTRICT,
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.profiles(id),
  incentive_type text NOT NULL,
  incentive_value numeric(12, 4) NOT NULL,
  gross_fare_cents integer NOT NULL,
  driver_net_cents integer NOT NULL,
  extra_cents integer NOT NULL,
  driver_incentive_multiplier numeric(12, 4),
  hours_on_trip numeric(12, 4),
  applied_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incentive_payouts_trip_incentive_uidx UNIQUE (trip_id, incentive_id)
);

COMMENT ON TABLE public.incentive_payouts IS
  'Per-trip link from a completed ride to each driver incentive that applied. extra_cents is the driver boost, not rider surge.';
COMMENT ON COLUMN public.incentive_payouts.driver_incentive_multiplier IS
  'Set only for type=multiplier. This is NOT game_day_events.surge_multiplier.';

CREATE INDEX IF NOT EXISTS incentive_payouts_incentive_id_idx ON public.incentive_payouts (incentive_id);
CREATE INDEX IF NOT EXISTS incentive_payouts_driver_id_idx ON public.incentive_payouts (driver_id);

CREATE TABLE IF NOT EXISTS public.incentive_presence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  incentive_id uuid NOT NULL REFERENCES public.driver_incentives(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  seen_on date NOT NULL,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT incentive_presence_uidx UNIQUE (incentive_id, driver_id, seen_on)
);

COMMENT ON TABLE public.incentive_presence IS
  'Driver was online on the driver home screen while this incentive window matched. Participation, separate from payouts.';

CREATE INDEX IF NOT EXISTS incentive_presence_incentive_id_idx ON public.incentive_presence (incentive_id);

CREATE TABLE IF NOT EXISTS public.driver_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL UNIQUE REFERENCES public.trips(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.profiles(id),
  gross_fare_cents integer NOT NULL,
  platform_fee_bps integer NOT NULL DEFAULT 2000,
  platform_fee_cents integer NOT NULL,
  driver_net_cents integer NOT NULL,
  incentive_extra_cents integer NOT NULL DEFAULT 0,
  driver_payout_cents integer NOT NULL,
  driver_incentive_multiplier numeric(12, 4),
  incentive_basis text NOT NULL DEFAULT 'driver_net',
  hours_on_trip numeric(12, 4),
  breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Earnings dashboard may add columns. Do not drop this table.
ALTER TABLE public.driver_earnings ADD COLUMN IF NOT EXISTS gross_fare_cents integer;
ALTER TABLE public.driver_earnings ADD COLUMN IF NOT EXISTS platform_fee_bps integer DEFAULT 2000;
ALTER TABLE public.driver_earnings ADD COLUMN IF NOT EXISTS platform_fee_cents integer;
ALTER TABLE public.driver_earnings ADD COLUMN IF NOT EXISTS driver_net_cents integer;
ALTER TABLE public.driver_earnings ADD COLUMN IF NOT EXISTS incentive_extra_cents integer DEFAULT 0;
ALTER TABLE public.driver_earnings ADD COLUMN IF NOT EXISTS driver_payout_cents integer;
ALTER TABLE public.driver_earnings ADD COLUMN IF NOT EXISTS driver_incentive_multiplier numeric(12, 4);
ALTER TABLE public.driver_earnings ADD COLUMN IF NOT EXISTS incentive_basis text DEFAULT 'driver_net';
ALTER TABLE public.driver_earnings ADD COLUMN IF NOT EXISTS hours_on_trip numeric(12, 4);
ALTER TABLE public.driver_earnings ADD COLUMN IF NOT EXISTS breakdown jsonb DEFAULT '[]'::jsonb;

COMMENT ON TABLE public.driver_earnings IS
  'One row per completed trip. incentive_extra_cents is the driver incentive on top of driver_net (80% of rider fare). Not rider surge.';
COMMENT ON COLUMN public.driver_earnings.incentive_basis IS
  'driver_net: multipliers and hourly floors apply to fare minus 20% platform fee. Extra is not charged to the rider.';
COMMENT ON COLUMN public.driver_earnings.driver_incentive_multiplier IS
  'Product of matching driver incentive multipliers. Null when none. Not rider surge.';

CREATE INDEX IF NOT EXISTS driver_earnings_driver_id_idx ON public.driver_earnings (driver_id);

DROP TRIGGER IF EXISTS driver_incentives_updated_at ON public.driver_incentives;
CREATE TRIGGER driver_incentives_updated_at
  BEFORE UPDATE ON public.driver_incentives
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.is_incentive_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'john@gmail.com'
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          lower(coalesce(p.email, '')) = 'john@gmail.com'
          OR p.role::text IN ('admin', 'ops')
          OR p.is_admin IS TRUE
        )
    );
$$;

COMMENT ON FUNCTION public.is_incentive_admin() IS
  'True for john@gmail.com, profiles.role admin/ops, or profiles.is_admin.';

CREATE OR REPLACE FUNCTION public.driver_incentive_is_active(
  p public.driver_incentives,
  p_at timestamptz,
  p_game_day boolean
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  tz text;
  local_ts timestamp;
  dow int;
  tod time;
  start_t time;
  end_t time;
  prev_dow int;
  has_days boolean;
  night_ok boolean;
BEGIN
  IF NOT COALESCE(p.active, false) THEN
    RETURN false;
  END IF;
  IF p.starts_at IS NOT NULL AND p_at < p.starts_at THEN
    RETURN false;
  END IF;
  IF p.ends_at IS NOT NULL AND p_at > p.ends_at THEN
    RETURN false;
  END IF;

  tz := COALESCE(NULLIF(p.timezone, ''), 'America/New_York');
  local_ts := p_at AT TIME ZONE tz;
  dow := EXTRACT(DOW FROM local_ts)::int;
  tod := local_ts::time;
  start_t := COALESCE(p.night_start, '19:00'::time);
  end_t := COALESCE(p.night_end, '02:00'::time);
  prev_dow := (dow + 6) % 7;
  has_days := p.days_of_week IS NOT NULL AND cardinality(p.days_of_week) > 0;
  night_ok := false;

  IF has_days THEN
    IF end_t > start_t THEN
      night_ok := dow = ANY (p.days_of_week) AND tod >= start_t AND tod < end_t;
    ELSIF tod >= start_t THEN
      night_ok := dow = ANY (p.days_of_week);
    ELSIF tod < end_t THEN
      night_ok := prev_dow = ANY (p.days_of_week);
    END IF;
  END IF;

  IF night_ok THEN
    RETURN true;
  END IF;
  IF COALESCE(p.game_day, false) AND COALESCE(p_game_day, false) THEN
    RETURN true;
  END IF;
  IF p.starts_at IS NOT NULL AND p.ends_at IS NOT NULL AND NOT has_days THEN
    RETURN true;
  END IF;
  IF NOT has_days AND NOT COALESCE(p.game_day, false) AND (p.starts_at IS NOT NULL OR p.ends_at IS NOT NULL) THEN
    RETURN true;
  END IF;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.driver_incentive_summary(p_trip_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'trip_id', e.trip_id,
    'driver_id', e.driver_id,
    'gross_fare_cents', e.gross_fare_cents,
    'platform_fee_cents', e.platform_fee_cents,
    'driver_net_cents', e.driver_net_cents,
    'incentive_extra_cents', e.incentive_extra_cents,
    'driver_payout_cents', e.driver_payout_cents,
    'driver_incentive_multiplier', e.driver_incentive_multiplier,
    'incentive_basis', e.incentive_basis,
    'hours_on_trip', e.hours_on_trip,
    'breakdown', e.breakdown
  )
  FROM public.driver_earnings e
  WHERE e.trip_id = p_trip_id;
$$;

CREATE OR REPLACE FUNCTION public.apply_trip_driver_incentives_internal(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.trips%ROWTYPE;
  v_at timestamptz;
  v_game boolean;
  v_gross integer;
  v_fee integer;
  v_net integer;
  v_running integer;
  v_bonus integer := 0;
  v_mult numeric := NULL;
  v_hours numeric;
  v_subtotal integer;
  v_winner uuid;
  v_guarantee integer;
  v_topup integer := 0;
  v_extra_sum integer := 0;
  v_extra integer;
  v_next integer;
  inc public.driver_incentives;
  v_lines jsonb := '[]'::jsonb;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_trip_id::text)::bigint);

  IF EXISTS (SELECT 1 FROM public.driver_earnings e WHERE e.trip_id = p_trip_id) THEN
    RETURN public.driver_incentive_summary(p_trip_id);
  END IF;

  SELECT * INTO t FROM public.trips WHERE id = p_trip_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip not found';
  END IF;
  IF t.status::text <> 'completed' THEN
    RAISE EXCEPTION 'trip is not completed';
  END IF;
  IF t.driver_id IS NULL THEN
    RAISE EXCEPTION 'trip has no driver';
  END IF;

  v_at := COALESCE(t.completed_at, now());
  -- Presence of a game_day_events row only. surge_multiplier is rider surge and is ignored.
  v_game := EXISTS (
    SELECT 1
    FROM public.game_day_events g
    WHERE g.active
      AND g.starts_at <= v_at
      AND g.ends_at >= v_at
  );

  v_gross := GREATEST(COALESCE(t.fare_cents, 0), 0);
  v_fee := ROUND(v_gross * 20.0 / 100.0)::integer;
  v_net := v_gross - v_fee;
  v_running := v_net;
  v_hours := EXTRACT(EPOCH FROM (v_at - COALESCE(t.accepted_at, v_at - interval '1 minute'))) / 3600.0;
  IF v_hours IS NULL OR v_hours < (1.0 / 60.0) THEN
    v_hours := 1.0 / 60.0;
  END IF;

  FOR inc IN
    SELECT i.*
    FROM public.driver_incentives i
    WHERE i.type = 'multiplier'
      AND public.driver_incentive_is_active(i, v_at, v_game)
    ORDER BY i.id
  LOOP
    v_next := ROUND(v_running * inc.value)::integer;
    v_extra := v_next - v_running;
    v_running := v_next;
    IF v_mult IS NULL THEN
      v_mult := inc.value;
    ELSE
      v_mult := v_mult * inc.value;
    END IF;
    INSERT INTO public.incentive_payouts (
      incentive_id, trip_id, driver_id, incentive_type, incentive_value,
      gross_fare_cents, driver_net_cents, extra_cents, driver_incentive_multiplier, hours_on_trip
    ) VALUES (
      inc.id, t.id, t.driver_id, inc.type, inc.value,
      v_gross, v_net, v_extra, inc.value, v_hours
    );
    v_extra_sum := v_extra_sum + v_extra;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'incentive_id', inc.id,
      'name', inc.name,
      'type', inc.type,
      'value', inc.value,
      'extra_cents', v_extra,
      'driver_incentive_multiplier', inc.value
    ));
  END LOOP;

  FOR inc IN
    SELECT i.*
    FROM public.driver_incentives i
    WHERE i.type = 'bonus_per_ride'
      AND public.driver_incentive_is_active(i, v_at, v_game)
    ORDER BY i.id
  LOOP
    v_extra := GREATEST(0, ROUND(inc.value)::integer);
    v_bonus := v_bonus + v_extra;
    INSERT INTO public.incentive_payouts (
      incentive_id, trip_id, driver_id, incentive_type, incentive_value,
      gross_fare_cents, driver_net_cents, extra_cents, driver_incentive_multiplier, hours_on_trip
    ) VALUES (
      inc.id, t.id, t.driver_id, inc.type, inc.value,
      v_gross, v_net, v_extra, NULL, v_hours
    );
    v_extra_sum := v_extra_sum + v_extra;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'incentive_id', inc.id,
      'name', inc.name,
      'type', inc.type,
      'value', inc.value,
      'extra_cents', v_extra,
      'driver_incentive_multiplier', NULL
    ));
  END LOOP;

  v_subtotal := v_running + v_bonus;

  SELECT i.id, ROUND(i.value * v_hours)::integer
    INTO v_winner, v_guarantee
  FROM public.driver_incentives i
  WHERE i.type = 'hourly_guarantee'
    AND public.driver_incentive_is_active(i, v_at, v_game)
  ORDER BY i.value DESC, i.id ASC
  LIMIT 1;

  IF v_winner IS NOT NULL THEN
    v_topup := GREATEST(0, COALESCE(v_guarantee, 0) - v_subtotal);
  END IF;

  FOR inc IN
    SELECT i.*
    FROM public.driver_incentives i
    WHERE i.type = 'hourly_guarantee'
      AND public.driver_incentive_is_active(i, v_at, v_game)
    ORDER BY i.id
  LOOP
    v_extra := CASE WHEN inc.id = v_winner THEN v_topup ELSE 0 END;
    INSERT INTO public.incentive_payouts (
      incentive_id, trip_id, driver_id, incentive_type, incentive_value,
      gross_fare_cents, driver_net_cents, extra_cents, driver_incentive_multiplier, hours_on_trip
    ) VALUES (
      inc.id, t.id, t.driver_id, inc.type, inc.value,
      v_gross, v_net, v_extra, NULL, v_hours
    );
    v_extra_sum := v_extra_sum + v_extra;
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'incentive_id', inc.id,
      'name', inc.name,
      'type', inc.type,
      'value', inc.value,
      'extra_cents', v_extra,
      'driver_incentive_multiplier', NULL
    ));
  END LOOP;

  INSERT INTO public.driver_earnings (
    trip_id, driver_id, gross_fare_cents, platform_fee_bps, platform_fee_cents,
    driver_net_cents, incentive_extra_cents, driver_payout_cents,
    driver_incentive_multiplier, incentive_basis, hours_on_trip, breakdown
  ) VALUES (
    t.id, t.driver_id, v_gross, 2000, v_fee,
    v_net, v_extra_sum, v_net + v_extra_sum,
    v_mult, 'driver_net', v_hours, v_lines
  );

  RETURN public.driver_incentive_summary(p_trip_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_trip_driver_incentives(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_driver uuid;
BEGIN
  SELECT driver_id INTO v_driver FROM public.trips WHERE id = p_trip_id;
  IF v_driver IS NULL THEN
    RAISE EXCEPTION 'trip not found or has no driver';
  END IF;
  IF auth.uid() IS DISTINCT FROM v_driver AND NOT public.is_incentive_admin() THEN
    RAISE EXCEPTION 'not allowed';
  END IF;
  RETURN public.apply_trip_driver_incentives_internal(p_trip_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_apply_driver_incentives()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status::text = 'completed' AND (OLD.status IS DISTINCT FROM NEW.status) THEN
    BEGIN
      PERFORM public.apply_trip_driver_incentives_internal(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'driver incentive apply failed for trip %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_apply_driver_incentives ON public.trips;
CREATE TRIGGER trips_apply_driver_incentives
  AFTER UPDATE OF status ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_apply_driver_incentives();

ALTER TABLE public.driver_incentives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.incentive_presence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_earnings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_incentives_read ON public.driver_incentives;
CREATE POLICY driver_incentives_read ON public.driver_incentives
  FOR SELECT TO anon, authenticated
  USING (active = true OR public.is_incentive_admin());

DROP POLICY IF EXISTS driver_incentives_insert ON public.driver_incentives;
CREATE POLICY driver_incentives_insert ON public.driver_incentives
  FOR INSERT TO authenticated
  WITH CHECK (public.is_incentive_admin());

DROP POLICY IF EXISTS driver_incentives_update ON public.driver_incentives;
CREATE POLICY driver_incentives_update ON public.driver_incentives
  FOR UPDATE TO authenticated
  USING (public.is_incentive_admin())
  WITH CHECK (public.is_incentive_admin());

DROP POLICY IF EXISTS driver_incentives_delete ON public.driver_incentives;
CREATE POLICY driver_incentives_delete ON public.driver_incentives
  FOR DELETE TO authenticated
  USING (public.is_incentive_admin());

DROP POLICY IF EXISTS incentive_payouts_read ON public.incentive_payouts;
CREATE POLICY incentive_payouts_read ON public.incentive_payouts
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.is_incentive_admin());

DROP POLICY IF EXISTS incentive_presence_read ON public.incentive_presence;
CREATE POLICY incentive_presence_read ON public.incentive_presence
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.is_incentive_admin());

DROP POLICY IF EXISTS incentive_presence_insert ON public.incentive_presence;
CREATE POLICY incentive_presence_insert ON public.incentive_presence
  FOR INSERT TO authenticated
  WITH CHECK (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_earnings_read ON public.driver_earnings;
CREATE POLICY driver_earnings_read ON public.driver_earnings
  FOR SELECT TO authenticated
  USING (driver_id = auth.uid() OR public.is_incentive_admin());

GRANT SELECT ON public.driver_incentives TO anon, authenticated;
GRANT INSERT, UPDATE, DELETE ON public.driver_incentives TO authenticated;
GRANT SELECT ON public.incentive_payouts TO authenticated;
GRANT SELECT, INSERT ON public.incentive_presence TO authenticated;
GRANT SELECT ON public.driver_earnings TO authenticated;

GRANT EXECUTE ON FUNCTION public.is_incentive_admin() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_trip_driver_incentives(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.apply_trip_driver_incentives_internal(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.driver_incentive_summary(uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE VIEW public.incentive_effectiveness AS
SELECT
  i.id AS incentive_id,
  i.name,
  i.type,
  i.value,
  i.game_day,
  i.days_of_week,
  i.active,
  i.starts_at,
  i.ends_at,
  COALESCE(pay.trips, 0) AS trips,
  COALESCE(pay.drivers_paid, 0) AS drivers_paid,
  COALESCE(pay.extra_cents, 0)::bigint AS extra_cents,
  COALESCE(pres.drivers_online, 0) AS drivers_online
FROM public.driver_incentives i
LEFT JOIN (
  SELECT
    incentive_id,
    COUNT(DISTINCT trip_id) AS trips,
    COUNT(DISTINCT driver_id) AS drivers_paid,
    COALESCE(SUM(extra_cents), 0)::bigint AS extra_cents
  FROM public.incentive_payouts
  GROUP BY incentive_id
) pay ON pay.incentive_id = i.id
LEFT JOIN (
  SELECT incentive_id, COUNT(DISTINCT driver_id) AS drivers_online
  FROM public.incentive_presence
  GROUP BY incentive_id
) pres ON pres.incentive_id = i.id;

COMMENT ON VIEW public.incentive_effectiveness IS
  'Incentive usage: trips completed under the window, extra cents paid to drivers, distinct drivers paid, distinct drivers seen online. Service role only.';

REVOKE ALL ON public.incentive_effectiveness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.incentive_effectiveness TO service_role;

INSERT INTO public.driver_incentives (
  name, type, value, days_of_week, night_start, night_end, game_day, active, timezone
)
SELECT v.name, v.type, v.value, v.days_of_week, v.night_start, v.night_end, v.game_day, v.active, v.timezone
FROM (
  VALUES
    ('Thursday night', 'multiplier', 1.5::numeric, ARRAY[4]::integer[], '19:00'::time, '02:00'::time, false, true, 'America/New_York'),
    ('Friday night', 'multiplier', 1.5::numeric, ARRAY[5]::integer[], '19:00'::time, '02:00'::time, false, true, 'America/New_York'),
    ('Saturday night', 'multiplier', 1.5::numeric, ARRAY[6]::integer[], '19:00'::time, '02:00'::time, false, true, 'America/New_York'),
    ('Clemson game day', 'bonus_per_ride', 500::numeric, ARRAY[]::integer[], '00:00'::time, '23:59'::time, true, true, 'America/New_York')
) AS v(name, type, value, days_of_week, night_start, night_end, game_day, active, timezone)
WHERE NOT EXISTS (
  SELECT 1 FROM public.driver_incentives d WHERE d.name = v.name
);
