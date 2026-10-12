-- NOT APPLIED — needs John's approval before running
--
-- Reject trip accepts from a driver who is not approved.
--
-- Apply on Supabase project awktabuhijrshmsmagpq only after John approves.
-- This file does not read or write provider secrets. Do not run it from a
-- deploy, the Supabase CLI, or the SQL editor until then.
--
-- An accept is the trips UPDATE public.trip_update_is_accept already detects
-- (pool or canceled row moves to accepted, or that row gains its first
-- driver) and public.accept_scheduled_trip. Both raise unless the accepting
-- driver's public.driver_applications.onboarding_status is 'approved' or
-- public.is_admin() is true. No application row counts as not approved.
-- Pending review, pending info, pending docs, and rejected all raise.
--
-- The accepting driver is the driver written on the row (NEW.driver_id), or
-- auth.uid() when that accept does not set a driver. public.is_admin() is the
-- session check from 20260924190000_admin_support.sql, so an admin can accept
-- without an approved application. A service-role update (no auth.uid()) can
-- still assign a driver whose application is approved.
--
-- The unpaid airport-deposit check stays. This file does not replace
-- public.block_unpaid_airport_deposit_accept and does not drop
-- trips_block_unpaid_airport_deposit_accept. accept_scheduled_trip keeps that
-- deposit check and runs this gate after it. On a direct UPDATE, trigger name
-- order runs this gate before the deposit trigger, so a row that fails both
-- raises the approval error. Approved drivers still hit the deposit trigger.
--
-- Version prefix 20260925120000 is already used by
-- 20260925120000_ambassador_payout_unique.sql. Rename this file to a free
-- version before applying if the Supabase CLI rejects the duplicate.

CREATE OR REPLACE FUNCTION public.assert_driver_may_accept(p_driver uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_admin() THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.driver_applications
    WHERE profile_id = p_driver
      AND onboarding_status = 'approved'
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Finish approval to go online. Your account is still under review.'
    USING ERRCODE = 'P0001';
END;
$$;

REVOKE ALL ON FUNCTION public.assert_driver_may_accept(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.block_unapproved_driver_accept()
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
  THEN
    PERFORM public.assert_driver_may_accept(COALESCE(NEW.driver_id, auth.uid()));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_block_unapproved_driver_accept ON public.trips;
CREATE TRIGGER trips_block_unapproved_driver_accept
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.block_unapproved_driver_accept();

-- Scheduled accepts bypass RLS. Lock, keep the unpaid-deposit check, then
-- require an approved driver or an admin. The UPDATE also fires the trigger.
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

REVOKE ALL ON FUNCTION public.accept_scheduled_trip(uuid) FROM PUBLIC;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.accept_scheduled_trip(uuid) TO authenticated;
  END IF;
END $$;
