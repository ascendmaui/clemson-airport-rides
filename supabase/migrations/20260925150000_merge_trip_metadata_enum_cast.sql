-- Fix: trips.status is the public.trip_status enum, so the original function failed on
-- every call with "operator does not exist: trip_status = text" (found in the 9/25 prod
-- smoke test: airport-checkout session bind, abandon-checkout release, hold expiry cancel).
-- Same signature and body, with explicit casts. Idempotent (CREATE OR REPLACE keeps grants,
-- the REVOKE/GRANT below re-assert them).

CREATE OR REPLACE FUNCTION public.merge_trip_metadata(
  p_trip_id uuid,
  p_patch jsonb,
  p_expected_statuses text[] DEFAULT NULL,
  p_new_status text DEFAULT NULL,
  p_canceled_at timestamptz DEFAULT NULL,
  p_clear_claim boolean DEFAULT false,
  p_require_unassigned boolean DEFAULT false,
  p_require_unabandoned boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.trips;
BEGIN
  IF p_trip_id IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.trips
  SET
    metadata = (COALESCE(metadata, '{}'::jsonb) - 'hold_expire_claim') || COALESCE(p_patch, '{}'::jsonb),
    status = COALESCE(p_new_status::public.trip_status, status),
    canceled_at = CASE
      WHEN p_canceled_at IS NOT NULL THEN p_canceled_at
      WHEN p_new_status = 'canceled' THEN now()
      ELSE canceled_at
    END,
    hold_expire_claimed_at = CASE
      WHEN p_clear_claim THEN NULL
      ELSE hold_expire_claimed_at
    END
  WHERE id = p_trip_id
    AND (p_expected_statuses IS NULL OR status::text = ANY(p_expected_statuses))
    AND (NOT p_require_unassigned OR driver_id IS NULL)
    AND (NOT p_require_unabandoned OR metadata->>'checkout_abandoned' IS NULL)
  RETURNING * INTO v_row;

  IF v_row.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'canceled_at', v_row.canceled_at,
    'metadata', v_row.metadata
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_trip_metadata(uuid, jsonb, text[], text, timestamptz, boolean, boolean, boolean) FROM PUBLIC;
-- Supabase grants EXECUTE on new public functions to anon and authenticated by
-- default privileges, so REVOKE FROM PUBLIC alone does not remove them. This
-- SECURITY DEFINER function must only be callable by the server (service_role).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.merge_trip_metadata(uuid, jsonb, text[], text, timestamptz, boolean, boolean, boolean) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE EXECUTE ON FUNCTION public.merge_trip_metadata(uuid, jsonb, text[], text, timestamptz, boolean, boolean, boolean) FROM authenticated;
  END IF;
END $$;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.merge_trip_metadata(uuid, jsonb, text[], text, timestamptz, boolean, boolean, boolean) TO service_role;
  END IF;
END $$;
