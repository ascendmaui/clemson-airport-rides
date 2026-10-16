-- The driver-facing accept error says card hold. This replaces the sentence
-- stored in the accept trigger and in accept_scheduled_trip. It does not
-- change who may accept a ride. Not applied by this change; run it yourself.

CREATE OR REPLACE FUNCTION public.block_unpaid_airport_deposit_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    RAISE EXCEPTION 'This airport ride still has an unpaid card hold. It is not claimable until the rider pays.'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_scheduled_trip(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
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
    RAISE EXCEPTION 'This airport ride still has an unpaid card hold. It is not claimable until the rider pays.'
      USING ERRCODE = 'P0001';
  END IF;

  PERFORM public.assert_driver_may_accept(actor);

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
