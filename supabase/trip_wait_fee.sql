-- Pickup wait fee columns, formula, trigger, and trip_wait_apply.
-- Apply supabase/trip_wait_status.sql first and commit it. Postgres cannot
-- use a new enum value in the same transaction that adds it.
--
-- Clock: trips.arrived_at (server now() when status becomes arrived).
-- Fee: $0 for 3 minutes, then ceil($1 per minute), capped at 7:00 = $4 wait.
-- Platform keeps 20% of the rider charge (public.platform_fee_cents), driver the rest.
-- Completed trips and optional driver cancel: 20/80 on wait_fee_cents only.
-- At 7:00 the row becomes cancelled_wait with reason auto:
--   wait_fee_cents 400, cancel_fee_cents 100, rider $5.
--   platform_fee_cents 100, driver_wait_earnings_cents 400 (20% of the $5 package).

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS arrived_at timestamptz;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS wait_fee_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS cancel_fee_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS platform_fee_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS driver_wait_earnings_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS wait_cancel_reason text;

ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_wait_cancel_reason_check;
ALTER TABLE public.trips ADD CONSTRAINT trips_wait_cancel_reason_check
  CHECK (wait_cancel_reason IS NULL OR wait_cancel_reason = ANY (ARRAY['driver'::text, 'auto'::text]));

ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_wait_fee_nonneg;
ALTER TABLE public.trips ADD CONSTRAINT trips_wait_fee_nonneg
  CHECK (
    wait_fee_cents >= 0
    AND cancel_fee_cents >= 0
    AND platform_fee_cents >= 0
    AND driver_wait_earnings_cents >= 0
  );

COMMENT ON COLUMN public.trips.arrived_at IS 'Server timestamp when the driver tapped Arrive. Wait fee clock.';
COMMENT ON COLUMN public.trips.wait_fee_cents IS 'Accrued rider wait fee in cents. $0 during 3 min grace, then $1 per ceil minute, cap $4 at 7:00.';
COMMENT ON COLUMN public.trips.cancel_fee_cents IS 'Cancellation fee in cents. $1 (100) on 7:00 auto-cancel only.';
COMMENT ON COLUMN public.trips.platform_fee_cents IS 'Platform 20% of the rider wait/cancel charge. Auto-cancel $5 package: 100. Otherwise 20% of wait_fee_cents.';
COMMENT ON COLUMN public.trips.driver_wait_earnings_cents IS 'Driver 80% of the rider charge. Auto-cancel $5 package: 400 (the full wait fee). Otherwise 80% of wait_fee_cents.';
COMMENT ON COLUMN public.trips.wait_cancel_reason IS 'driver = optional cancel after 5:00; auto = forced at 7:00.';

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_kind_check
  CHECK (kind = ANY (ARRAY[
    'deposit'::text,
    'balance'::text,
    'refund'::text,
    'friend_ride_share'::text,
    'wait_fee'::text,
    'cancel_fee'::text
  ]));

-- Mirrors src/lib/platformFee.js platformFeeCents (Math.round(amount * 0.2)).
CREATE OR REPLACE FUNCTION public.platform_fee_cents(amount_cents integer)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT ROUND(GREATEST(0, COALESCE(amount_cents, 0)) * 0.2)::integer;
$$;

CREATE OR REPLACE FUNCTION public.compute_wait_fee_cents(arrived timestamptz, at_time timestamptz)
RETURNS integer
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  elapsed_ms numeric;
  after_grace_ms numeric;
  minutes integer;
BEGIN
  IF arrived IS NULL OR at_time IS NULL THEN
    RETURN 0;
  END IF;
  elapsed_ms := EXTRACT(EPOCH FROM (at_time - arrived)) * 1000;
  IF elapsed_ms < 0 THEN
    RETURN 0;
  END IF;
  -- Cap at 7:00 (420000 ms) so a late settle cannot bill a 5th minute.
  after_grace_ms := GREATEST(0, LEAST(elapsed_ms, 420000) - 180000);
  IF after_grace_ms = 0 THEN
    RETURN 0;
  END IF;
  minutes := CEIL(after_grace_ms / 60000)::integer;
  RETURN minutes * 100;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_trip_wait_fees()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  elapsed_sec numeric;
BEGIN
  IF NEW.status = 'arrived'::public.trip_status AND OLD.status IS DISTINCT FROM 'arrived'::public.trip_status THEN
    NEW.arrived_at := now();
    NEW.wait_fee_cents := 0;
    NEW.cancel_fee_cents := 0;
    NEW.platform_fee_cents := 0;
    NEW.driver_wait_earnings_cents := 0;
    NEW.wait_cancel_reason := NULL;
    RETURN NEW;
  END IF;

  IF OLD.arrived_at IS NOT NULL THEN
    NEW.arrived_at := OLD.arrived_at;
  END IF;

  IF OLD.status = 'arrived'::public.trip_status AND NEW.status = 'arrived'::public.trip_status THEN
    NEW.wait_fee_cents := public.compute_wait_fee_cents(OLD.arrived_at, now());
    NEW.cancel_fee_cents := 0;
    NEW.platform_fee_cents := public.platform_fee_cents(NEW.wait_fee_cents);
    NEW.driver_wait_earnings_cents := NEW.wait_fee_cents - NEW.platform_fee_cents;
    NEW.wait_cancel_reason := NULL;
    RETURN NEW;
  END IF;

  IF OLD.status = 'arrived'::public.trip_status AND NEW.status IS DISTINCT FROM 'arrived'::public.trip_status THEN
    elapsed_sec := EXTRACT(EPOCH FROM (now() - OLD.arrived_at));
    NEW.wait_fee_cents := public.compute_wait_fee_cents(OLD.arrived_at, now());
    -- 7:00 is a hard stop, whatever status the client asked for.
    IF elapsed_sec >= 420 THEN
      NEW.status := 'cancelled_wait'::public.trip_status;
      NEW.wait_cancel_reason := 'auto';
      NEW.canceled_at := COALESCE(NEW.canceled_at, now());
      NEW.cancel_fee_cents := 100;
      NEW.platform_fee_cents := public.platform_fee_cents(NEW.wait_fee_cents + NEW.cancel_fee_cents);
      NEW.driver_wait_earnings_cents := NEW.wait_fee_cents + NEW.cancel_fee_cents - NEW.platform_fee_cents;
    ELSIF NEW.status = 'cancelled_wait'::public.trip_status THEN
      IF elapsed_sec < 300 THEN
        RAISE EXCEPTION 'wait_cancel_too_early';
      END IF;
      NEW.wait_cancel_reason := 'driver';
      NEW.cancel_fee_cents := 0;
      NEW.platform_fee_cents := public.platform_fee_cents(NEW.wait_fee_cents);
      NEW.driver_wait_earnings_cents := NEW.wait_fee_cents - NEW.platform_fee_cents;
      NEW.canceled_at := COALESCE(NEW.canceled_at, now());
    ELSE
      NEW.wait_cancel_reason := NULL;
      NEW.cancel_fee_cents := 0;
      NEW.platform_fee_cents := public.platform_fee_cents(NEW.wait_fee_cents);
      NEW.driver_wait_earnings_cents := NEW.wait_fee_cents - NEW.platform_fee_cents;
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.arrived_at IS NOT NULL AND OLD.status IN (
    'in_progress'::public.trip_status,
    'completed'::public.trip_status,
    'cancelled_wait'::public.trip_status
  ) THEN
    NEW.wait_fee_cents := OLD.wait_fee_cents;
    NEW.cancel_fee_cents := OLD.cancel_fee_cents;
    NEW.platform_fee_cents := OLD.platform_fee_cents;
    NEW.driver_wait_earnings_cents := OLD.driver_wait_earnings_cents;
    NEW.wait_cancel_reason := OLD.wait_cancel_reason;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_enforce_wait_fee ON public.trips;
CREATE TRIGGER trips_enforce_wait_fee
  BEFORE UPDATE ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_trip_wait_fees();

CREATE OR REPLACE FUNCTION public.trip_wait_apply(p_trip_id uuid, p_action text, p_actor uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.trips%ROWTYPE;
  n public.trips%ROWTYPE;
  prev_status public.trip_status;
  elapsed_sec numeric;
  v_kind text;
  v_charge boolean := false;
  v_now timestamptz := now();
BEGIN
  IF p_actor IS NULL THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO t FROM public.trips WHERE id = p_trip_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'trip_not_found';
  END IF;

  IF p_actor IS DISTINCT FROM t.driver_id AND NOT (p_action = 'tick' AND p_actor = t.rider_id) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  prev_status := t.status;
  elapsed_sec := CASE
    WHEN t.arrived_at IS NULL THEN 0
    ELSE EXTRACT(EPOCH FROM (v_now - t.arrived_at))
  END;

  IF p_action = 'arrive' THEN
    IF p_actor IS DISTINCT FROM t.driver_id THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    IF t.status = 'arrived' THEN
      NULL;
    ELSIF t.status IN ('accepted'::public.trip_status, 'arriving'::public.trip_status) THEN
      UPDATE public.trips
        SET status = 'arrived'
        WHERE id = t.id
        RETURNING * INTO n;
        IF FOUND THEN t := n; END IF;
    ELSE
      RAISE EXCEPTION 'invalid_status';
    END IF;
  ELSIF p_action = 'tick' THEN
    IF t.status = 'arrived' AND t.arrived_at IS NOT NULL AND elapsed_sec >= 420 THEN
      UPDATE public.trips
        SET status = 'cancelled_wait',
            wait_cancel_reason = 'auto',
            canceled_at = v_now
        WHERE id = t.id AND status = 'arrived'
        RETURNING * INTO n;
        IF FOUND THEN t := n; END IF;
    ELSIF t.status = 'arrived' AND t.arrived_at IS NOT NULL THEN
      UPDATE public.trips
        SET wait_fee_cents = public.compute_wait_fee_cents(t.arrived_at, v_now)
        WHERE id = t.id AND status = 'arrived'
        RETURNING * INTO n;
        IF FOUND THEN t := n; END IF;
    END IF;
  ELSIF p_action = 'cancel' THEN
    IF p_actor IS DISTINCT FROM t.driver_id THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    IF t.status <> 'arrived' THEN
      RAISE EXCEPTION 'invalid_status';
    END IF;
    UPDATE public.trips
      SET status = 'cancelled_wait',
          wait_cancel_reason = CASE WHEN elapsed_sec >= 420 THEN 'auto' ELSE 'driver' END,
          canceled_at = v_now
      WHERE id = t.id AND status = 'arrived'
      RETURNING * INTO n;
        IF FOUND THEN t := n; END IF;
  ELSIF p_action = 'start' THEN
    IF p_actor IS DISTINCT FROM t.driver_id THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    IF t.status <> 'arrived' THEN
      RAISE EXCEPTION 'invalid_status';
    END IF;
    IF elapsed_sec >= 420 THEN
      UPDATE public.trips
        SET status = 'cancelled_wait',
            wait_cancel_reason = 'auto',
            canceled_at = v_now
        WHERE id = t.id AND status = 'arrived'
        RETURNING * INTO n;
        IF FOUND THEN t := n; END IF;
    ELSE
      UPDATE public.trips
        SET status = 'in_progress'
        WHERE id = t.id AND status = 'arrived'
        RETURNING * INTO n;
        IF FOUND THEN t := n; END IF;
    END IF;
  ELSIF p_action = 'complete' THEN
    IF p_actor IS DISTINCT FROM t.driver_id THEN
      RAISE EXCEPTION 'forbidden';
    END IF;
    IF t.status = 'in_progress' THEN
      UPDATE public.trips
        SET status = 'completed',
            completed_at = v_now
        WHERE id = t.id AND status = 'in_progress'
        RETURNING * INTO n;
        IF FOUND THEN t := n; END IF;
    ELSIF t.status <> 'completed' THEN
      RAISE EXCEPTION 'invalid_status';
    END IF;
  ELSE
    RAISE EXCEPTION 'bad_action';
  END IF;

  v_charge := (
    (t.status = 'cancelled_wait' AND prev_status IS DISTINCT FROM 'cancelled_wait')
    OR (t.status = 'cancelled_wait' AND p_action IN ('tick', 'cancel'))
    OR (p_action = 'complete' AND t.status = 'completed' AND COALESCE(t.wait_fee_cents, 0) > 0)
  );

  IF t.status IS DISTINCT FROM prev_status THEN
    v_kind := t.status::text;
    INSERT INTO public.trip_events (trip_id, kind, payload)
    VALUES (
      t.id,
      v_kind,
      jsonb_build_object(
        'action', p_action,
        'from', prev_status,
        'arrived_at', t.arrived_at,
        'wait_fee_cents', t.wait_fee_cents,
        'cancel_fee_cents', t.cancel_fee_cents,
        'platform_fee_cents', t.platform_fee_cents,
        'driver_wait_earnings_cents', t.driver_wait_earnings_cents,
        'wait_cancel_reason', t.wait_cancel_reason,
        'actor_id', p_actor
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'trip', to_jsonb(t),
    'server_now', v_now,
    'should_charge', v_charge
  );
END;
$$;

REVOKE ALL ON FUNCTION public.trip_wait_apply(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trip_wait_apply(uuid, text, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.trip_wait_apply(uuid, text, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trip_wait_apply(uuid, text, uuid) TO service_role;
