-- Scheduled rides
-- Applied on awktabuhijrshmsmagpq via Supabase migrations:
--   scheduled_rides_status_pickup_at
--   scheduled_rides_accept_and_rls

ALTER TYPE public.trip_status ADD VALUE IF NOT EXISTS 'scheduled';

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS pickup_at timestamptz;
COMMENT ON COLUMN public.trips.pickup_at IS 'When the rider wants to be picked up. Required when status=scheduled.';

UPDATE public.trips
SET pickup_at = scheduled_for
WHERE pickup_at IS NULL AND scheduled_for IS NOT NULL;

ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_scheduled_requires_pickup_at;
ALTER TABLE public.trips ADD CONSTRAINT trips_scheduled_requires_pickup_at
  CHECK (status <> 'scheduled'::public.trip_status OR pickup_at IS NOT NULL);

CREATE INDEX IF NOT EXISTS trips_open_scheduled_pickup_idx
  ON public.trips (pickup_at)
  WHERE status = 'scheduled'::public.trip_status AND driver_id IS NULL;

CREATE OR REPLACE FUNCTION public.is_driver_or_admin_role()
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = ANY (ARRAY['driver'::public.user_role, 'admin'::public.user_role])
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_driver_or_admin_role() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_driver_or_admin_role() TO authenticated;

DROP POLICY IF EXISTS trips_driver_scheduled_select ON public.trips;
CREATE POLICY trips_driver_scheduled_select
ON public.trips
FOR SELECT
TO authenticated
USING (
  status = 'scheduled'::public.trip_status
  AND driver_id IS NULL
  AND public.is_driver_or_admin_role()
);

-- Unpaid airport-deposit accepts are rejected by
-- supabase/migrations/20260924233000_block_unpaid_airport_deposit_accept.sql.
-- Do not reapply the function body below on awktabuhijrshmsmagpq after that
-- migration; it would drop the deposit check.
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
    AND status = 'scheduled'
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
GRANT EXECUTE ON FUNCTION public.accept_scheduled_trip(uuid) TO authenticated;

-- Merges one reminder key without replacing acceptance_message or other metadata.
CREATE OR REPLACE FUNCTION public.stamp_scheduled_reminder(p_trip_id uuid, p_window text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  next_meta jsonb;
BEGIN
  IF actor IS NULL THEN
    RAISE EXCEPTION 'Sign in required' USING ERRCODE = '28000';
  END IF;
  IF p_window NOT IN ('m15', 'h1', 'h24', 'now') THEN
    RAISE EXCEPTION 'Unknown reminder window' USING ERRCODE = '22023';
  END IF;

  UPDATE public.trips
  SET metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
    'reminders',
    coalesce(metadata->'reminders', '{}'::jsonb) || jsonb_build_object(p_window, to_jsonb(now()))
  )
  WHERE id = p_trip_id
    AND (rider_id = actor OR driver_id = actor)
  RETURNING metadata INTO next_meta;

  IF next_meta IS NULL THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.trip_events (trip_id, kind, payload)
  VALUES (
    p_trip_id,
    'reminder',
    jsonb_build_object('window', p_window, 'source', 'scheduled_reminder')
  );

  RETURN next_meta;
END;
$$;

REVOKE ALL ON FUNCTION public.stamp_scheduled_reminder(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.stamp_scheduled_reminder(uuid, text) TO authenticated;
