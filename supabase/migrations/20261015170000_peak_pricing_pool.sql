-- Peak pricing pool (feature flag PEAK_PRICING_ENABLED, default off). Additive only.
-- NOT APPLIED by the PR that adds it. Apply only after John approves peak pricing.
--
-- Regular completed rides earmark a share of the platform fee into the pool
-- (kind 'contribution'). Completed peak rides draw a small driver bonus from it
-- (kind 'draw'). The balance is contributions - draws - adjustments-out, and the
-- draw function caps every grant at the balance under a transaction lock, so
-- the pool can never go negative, even with concurrent settles.
--
-- Same access model as tiger_heat_ledger (#359): service_role writes through
-- the functions below; an authenticated session sees rows only when
-- public.is_admin(); anon has nothing. Bonuses reach drivers only through the
-- trip payout and the admin approval gate (#554).
--
-- Down (reversible):
--   drop trigger if exists trips_ab_strip_client_peak_pricing on public.trips;
--   drop function if exists public.strip_client_peak_pricing();
--   drop function if exists public.peak_pool_draw(uuid, uuid, integer);
--   drop function if exists public.peak_pool_contribute(uuid, integer, integer);
--   drop function if exists public.peak_pool_balance();
--   drop table if exists public.peak_pool_ledger;

CREATE TABLE IF NOT EXISTS public.peak_pool_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('contribution', 'draw', 'adjustment_in', 'adjustment_out')),
  trip_id uuid,
  driver_id uuid,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  requested_cents integer CHECK (requested_cents IS NULL OR requested_cents >= 0),
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One contribution and one draw per trip: settle retries are idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS peak_pool_ledger_trip_kind_uidx
  ON public.peak_pool_ledger (trip_id, kind)
  WHERE trip_id IS NOT NULL AND kind IN ('contribution', 'draw');
CREATE INDEX IF NOT EXISTS peak_pool_ledger_created_idx
  ON public.peak_pool_ledger (created_at DESC);

COMMENT ON TABLE public.peak_pool_ledger IS
  'Peak pricing driver bonus pool. Balance = contributions + adjustment_in - draws - adjustment_out. Writes go through peak_pool_contribute / peak_pool_draw only.';

ALTER TABLE public.peak_pool_ledger ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.peak_pool_ledger FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.peak_pool_ledger TO service_role;
GRANT SELECT ON TABLE public.peak_pool_ledger TO authenticated;

DROP POLICY IF EXISTS peak_pool_ledger_admin_select ON public.peak_pool_ledger;
CREATE POLICY peak_pool_ledger_admin_select
  ON public.peak_pool_ledger
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.peak_pool_balance()
RETURNS TABLE (balance_cents bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(sum(CASE WHEN l.kind IN ('contribution', 'adjustment_in') THEN l.amount_cents ELSE -l.amount_cents END), 0)::bigint
  FROM public.peak_pool_ledger l
$$;

-- Records a regular ride's contribution, trimmed so the pool stays at or under
-- p_ceiling_cents. Returns the cents recorded (0 when full or already recorded).
CREATE OR REPLACE FUNCTION public.peak_pool_contribute(
  p_trip_id uuid,
  p_amount_cents integer,
  p_ceiling_cents integer DEFAULT NULL
)
RETURNS TABLE (recorded_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_balance bigint;
  v_amount integer;
  v_existing integer;
BEGIN
  IF p_trip_id IS NULL OR coalesce(p_amount_cents, 0) <= 0 THEN
    RETURN QUERY SELECT 0;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('peak_pool_ledger'));
  SELECT amount_cents INTO v_existing FROM public.peak_pool_ledger
   WHERE trip_id = p_trip_id AND kind = 'contribution';
  IF FOUND THEN
    RETURN QUERY SELECT v_existing;
    RETURN;
  END IF;
  SELECT b.balance_cents INTO v_balance FROM public.peak_pool_balance() b;
  v_amount := p_amount_cents;
  IF p_ceiling_cents IS NOT NULL THEN
    v_amount := least(v_amount, greatest(0, p_ceiling_cents - v_balance)::integer);
  END IF;
  IF v_amount <= 0 THEN
    RETURN QUERY SELECT 0;
    RETURN;
  END IF;
  INSERT INTO public.peak_pool_ledger (kind, trip_id, amount_cents, requested_cents)
  VALUES ('contribution', p_trip_id, v_amount, p_amount_cents);
  RETURN QUERY SELECT v_amount;
END;
$$;

-- Draws a peak-trip bonus. Grants min(requested, balance); never overdraws.
-- A retry for the same trip returns the original grant.
CREATE OR REPLACE FUNCTION public.peak_pool_draw(
  p_trip_id uuid,
  p_driver_id uuid,
  p_requested_cents integer
)
RETURNS TABLE (granted_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_balance bigint;
  v_grant integer;
  v_existing integer;
BEGIN
  IF p_trip_id IS NULL OR coalesce(p_requested_cents, 0) <= 0 THEN
    RETURN QUERY SELECT 0;
    RETURN;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('peak_pool_ledger'));
  SELECT amount_cents INTO v_existing FROM public.peak_pool_ledger
   WHERE trip_id = p_trip_id AND kind = 'draw';
  IF FOUND THEN
    RETURN QUERY SELECT v_existing;
    RETURN;
  END IF;
  SELECT b.balance_cents INTO v_balance FROM public.peak_pool_balance() b;
  v_grant := least(p_requested_cents, greatest(0, v_balance))::integer;
  IF v_grant <= 0 THEN
    RETURN QUERY SELECT 0;
    RETURN;
  END IF;
  INSERT INTO public.peak_pool_ledger (kind, trip_id, driver_id, amount_cents, requested_cents)
  VALUES ('draw', p_trip_id, p_driver_id, v_grant, p_requested_cents);
  RETURN QUERY SELECT v_grant;
END;
$$;

REVOKE ALL ON FUNCTION public.peak_pool_balance() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.peak_pool_contribute(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.peak_pool_draw(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.peak_pool_balance() TO service_role;
GRANT EXECUTE ON FUNCTION public.peak_pool_contribute(uuid, integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.peak_pool_draw(uuid, uuid, integer) TO service_role;

-- Clients never seed peak payout data on a trip they insert. Runs after
-- trips_aa_guard_client_insert (trigger names fire in alphabetical order).
-- Client updates already reset metadata and fare_breakdown to the stored row.
CREATE OR REPLACE FUNCTION public.strip_client_peak_pricing()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;
  NEW.metadata := coalesce(NEW.metadata, '{}'::jsonb) - 'peak_pricing';
  NEW.fare_breakdown := coalesce(NEW.fare_breakdown, '{}'::jsonb)
    - 'peak_pricing_version' - 'peak_surcharge_bps' - 'peak_base_fare_cents'
    - 'peak_surcharge_cents' - 'peak_pay_base_cents' - 'peak_pay_peak_cents' - 'peak_reason';
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_ab_strip_client_peak_pricing ON public.trips;
CREATE TRIGGER trips_ab_strip_client_peak_pricing
  BEFORE INSERT ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.strip_client_peak_pricing();
