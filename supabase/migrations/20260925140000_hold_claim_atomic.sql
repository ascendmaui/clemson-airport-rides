-- Dedicated claim column and atomic metadata merge for unpaid airport hold expiry.
--
-- Prevents race conditions where claim/release or cancel whole-object updates to
-- trips.metadata clobber concurrent metadata writes from Stripe webhooks or other processes.

-- 1. Dedicated nullable column for sweep expiry claims.
ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS hold_expire_claimed_at timestamptz;

-- Partial index for active claims lookup.
CREATE INDEX IF NOT EXISTS trips_hold_expire_claimed_at_idx
  ON public.trips (hold_expire_claimed_at)
  WHERE hold_expire_claimed_at IS NOT NULL;

-- 2. Atomic trip metadata merge and conditional status update.
-- Merges p_patch into metadata without replacing the whole object.
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
    status = COALESCE(p_new_status, status),
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
    AND (p_expected_statuses IS NULL OR status = ANY(p_expected_statuses))
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
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.merge_trip_metadata(uuid, jsonb, text[], text, timestamptz, boolean, boolean, boolean) TO service_role;
  END IF;
END $$;
