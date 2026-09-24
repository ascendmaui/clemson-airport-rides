-- Reject driver accepts of unpaid airport-deposit trips.
--
-- Apply on Supabase project awktabuhijrshmsmagpq (SQL editor or migration runner).
-- This file does not read or write provider secrets.
--
-- Matches the driver-desk predicate (checkout_deposit object/array, or
-- fare_paid_cents >= deposit_cents). deposit_cents = 0 and non-airport trips
-- are not gated. Payment is read from the pre-update row so a forged UPDATE
-- cannot stamp checkout_deposit, fare_paid_cents, or deposit_cents in the
-- same statement as the accept.
--
-- Cancel and restore (#53) do not assign a driver and do not move a pool or
-- canceled row to accepted, so they pass. The check runs in the UPDATE's row
-- lock, including inside accept_scheduled_trip, so it serializes with those
-- writes. Direct trips.update is covered by the BEFORE UPDATE trigger because
-- trips_online_driver_claim still allows an online driver to claim a row.

CREATE OR REPLACE FUNCTION public.trip_json_cents(p_value text)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  n numeric;
BEGIN
  IF p_value IS NULL OR btrim(p_value) = '' THEN
    RETURN 0;
  END IF;
  BEGIN
    n := btrim(p_value)::numeric;
  EXCEPTION
    WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RETURN 0;
  END;
  RETURN GREATEST(0, ROUND(n)::integer);
END;
$$;

-- JavaScript truthiness for a jsonb airport flag (string, bool, number, object).
CREATE OR REPLACE FUNCTION public.jsonb_js_truthy(p_value jsonb)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_value IS NULL OR p_value = 'null'::jsonb THEN false
    WHEN jsonb_typeof(p_value) = 'boolean' THEN p_value = 'true'::jsonb
    WHEN jsonb_typeof(p_value) = 'number' THEN (p_value::text::numeric <> 0)
    WHEN jsonb_typeof(p_value) = 'string' THEN length(p_value #>> '{}') > 0
    WHEN jsonb_typeof(p_value) IN ('object', 'array') THEN true
    ELSE false
  END;
$$;

-- True when this row is an airport hold whose card deposit is still unpaid.
CREATE OR REPLACE FUNCTION public.trip_airport_deposit_unpaid(
  p_deposit_cents numeric,
  p_rider_note text,
  p_metadata jsonb
) RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  meta jsonb := COALESCE(p_metadata, '{}'::jsonb);
  required integer;
  is_airport boolean;
  paid boolean;
BEGIN
  IF jsonb_typeof(meta) IS DISTINCT FROM 'object' THEN
    meta := '{}'::jsonb;
  END IF;

  IF p_deposit_cents IS NOT NULL THEN
    required := GREATEST(0, ROUND(p_deposit_cents)::integer);
  ELSE
    required := public.trip_json_cents(meta->>'depositCents');
  END IF;

  is_airport := required > 0 AND (
    COALESCE(meta->>'purpose' = 'airport', false)
    OR COALESCE(meta->>'kind' = 'airport', false)
    OR COALESCE(public.jsonb_js_truthy(meta->'airport'), false)
    OR lower(btrim(COALESCE(p_rider_note, ''))) = 'airport'
  );

  IF NOT is_airport THEN
    RETURN false;
  END IF;

  paid := COALESCE(jsonb_typeof(meta->'checkout_deposit') IN ('object', 'array'), false)
    OR public.trip_json_cents(meta->>'fare_paid_cents') >= required;

  RETURN NOT paid;
END;
$$;

-- Accept/claim: move a pool or canceled hold to accepted, or assign its first driver.
CREATE OR REPLACE FUNCTION public.trip_update_is_accept(
  p_old_status text,
  p_new_status text,
  p_old_driver uuid,
  p_new_driver uuid
) RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    (
      p_new_status = 'accepted'
      AND p_old_status IS DISTINCT FROM 'accepted'
      AND p_old_status IN ('requested', 'searching', 'offered', 'scheduled', 'canceled')
    )
    OR (
      p_old_driver IS NULL
      AND p_new_driver IS NOT NULL
      AND p_old_status IN ('requested', 'searching', 'offered', 'scheduled', 'canceled')
    );
$$;

CREATE OR REPLACE FUNCTION public.block_unpaid_airport_deposit_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.trip_update_is_accept(
       OLD.status::text,
       NEW.status::text,
       OLD.driver_id,
       NEW.driver_id
     )
     AND public.trip_airport_deposit_unpaid(OLD.deposit_cents, OLD.rider_note, OLD.metadata)
  THEN
    RAISE EXCEPTION 'Airport deposit still unpaid. This ride is not claimable until the rider pays the deposit.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_block_unpaid_airport_deposit_accept ON public.trips;
CREATE TRIGGER trips_block_unpaid_airport_deposit_accept
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.block_unpaid_airport_deposit_accept();

-- Scheduled accepts bypass RLS. Lock the row, reject unpaid deposits, then claim.
CREATE OR REPLACE FUNCTION public.accept_scheduled_trip(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  row public.trips;
  actor uuid := auth.uid();
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Sign in required' USING ERRCODE = '28000';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = actor AND role IN ('driver', 'admin')
  ) THEN
    RAISE EXCEPTION 'Driver account required' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO row
  FROM public.trips
  WHERE id = p_trip_id
  FOR UPDATE;

  IF row.id IS NULL
     OR row.status::text <> 'scheduled'
     OR row.driver_id IS NOT NULL
     OR row.pickup_at IS NULL THEN
    RAISE EXCEPTION 'Scheduled ride is no longer available' USING ERRCODE = 'P0002';
  END IF;

  IF public.trip_airport_deposit_unpaid(row.deposit_cents, row.rider_note, row.metadata) THEN
    RAISE EXCEPTION 'Airport deposit still unpaid. This ride is not claimable until the rider pays the deposit.'
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.trips
  SET
    status = 'accepted',
    driver_id = actor,
    accepted_at = now(),
    metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'accepted_via', 'scheduled',
      'acceptance_message', 'Your driver accepted this scheduled ride.'
    )
  WHERE id = p_trip_id
    AND status::text = 'scheduled'
    AND driver_id IS NULL
    AND pickup_at IS NOT NULL
  RETURNING * INTO row;

  IF row.id IS NULL THEN
    RAISE EXCEPTION 'Scheduled ride is no longer available' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.trip_events (trip_id, kind, payload)
  VALUES (
    row.id,
    'accepted',
    jsonb_build_object(
      'driver_id', actor,
      'source', 'scheduled_accept',
      'message', 'Your driver accepted this scheduled ride.',
      'pickup_at', row.pickup_at
    )
  );

  RETURN jsonb_build_object(
    'id', row.id,
    'status', row.status,
    'driver_id', row.driver_id,
    'accepted_at', row.accepted_at,
    'pickup_label', row.pickup_label,
    'dropoff_label', row.dropoff_label,
    'pickup_at', row.pickup_at,
    'fare_cents', row.fare_cents,
    'rider_id', row.rider_id,
    'acceptance_message', 'Your driver accepted this scheduled ride.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.accept_scheduled_trip(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.accept_scheduled_trip(uuid) TO authenticated;
  END IF;
END $$;
