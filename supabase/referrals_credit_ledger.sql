-- Referral program: shareable codes + prepaid platform credit ledger.
-- No credit_ledger / referrals tables existed on project awktabuhijrshmsmagpq.
-- Amounts must match server/referralCredits.js
-- REFERRAL_REFERRER_CENTS=1000
-- REFERRAL_REFEREE_CENTS=1000

CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL,
  referrer_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  referee_id uuid REFERENCES public.profiles (id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'rewarded'::text, 'void'::text])),
  qualify_role text
    CHECK (qualify_role IS NULL OR qualify_role = ANY (ARRAY['rider'::text, 'driver'::text])),
  qualifying_trip_id uuid REFERENCES public.trips (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  rewarded_at timestamptz,
  CONSTRAINT referrals_no_self CHECK (referee_id IS NULL OR referrer_id <> referee_id)
);

COMMENT ON TABLE public.referrals IS
  'Anchor row (referee_id IS NULL) holds a user''s shareable code. Child rows attach a new user until their first completed rider or driver trip pays both sides.';

CREATE UNIQUE INDEX IF NOT EXISTS referrals_anchor_referrer_uidx
  ON public.referrals (referrer_id)
  WHERE referee_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS referrals_anchor_code_uidx
  ON public.referrals (code)
  WHERE referee_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS referrals_referee_uidx
  ON public.referrals (referee_id)
  WHERE referee_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS referrals_referrer_idx
  ON public.referrals (referrer_id);

CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  amount_cents integer NOT NULL CHECK (amount_cents <> 0),
  reason text NOT NULL,
  referral_id uuid REFERENCES public.referrals (id) ON DELETE SET NULL,
  trip_id uuid REFERENCES public.trips (id) ON DELETE SET NULL,
  idempotency_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.credit_ledger IS
  'Prepaid platform credits. Positive rows are grants (referral_referrer, referral_referee). Balance is the sum of amount_cents for a profile.';

CREATE INDEX IF NOT EXISTS credit_ledger_profile_idx
  ON public.credit_ledger (profile_id, created_at DESC);

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS referrals_select_parties ON public.referrals;
CREATE POLICY referrals_select_parties
  ON public.referrals
  FOR SELECT
  TO authenticated
  USING (auth.uid() = referrer_id OR auth.uid() = referee_id);

DROP POLICY IF EXISTS credit_ledger_select_own ON public.credit_ledger;
CREATE POLICY credit_ledger_select_own
  ON public.credit_ledger
  FOR SELECT
  TO authenticated
  USING (auth.uid() = profile_id);

REVOKE ALL ON public.referrals FROM anon, authenticated;
REVOKE ALL ON public.credit_ledger FROM anon, authenticated;
GRANT SELECT ON public.referrals TO authenticated;
GRANT SELECT ON public.credit_ledger TO authenticated;
GRANT ALL ON public.referrals TO service_role;
GRANT ALL ON public.credit_ledger TO service_role;

CREATE OR REPLACE FUNCTION public.grant_referral_credits(
  p_trip_id uuid,
  p_referrer_cents integer DEFAULT 1000,
  p_referee_cents integer DEFAULT 1000
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.trips%ROWTYPE;
  rec public.referrals%ROWTYPE;
  v_role text;
  v_prior bigint;
  v_locked uuid;
  v_results jsonb := '[]'::jsonb;
BEGIN
  IF p_referrer_cents IS NULL OR p_referrer_cents <= 0
     OR p_referee_cents IS NULL OR p_referee_cents <= 0
     OR p_referrer_cents > 10000 OR p_referee_cents > 10000 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_amounts');
  END IF;

  SELECT * INTO t FROM public.trips WHERE id = p_trip_id;
  IF NOT FOUND OR t.status <> 'completed' OR t.driver_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_a_completed_trip');
  END IF;

  FOR rec IN
    SELECT *
    FROM public.referrals
    WHERE status = 'pending'
      AND referee_id IS NOT NULL
      AND (referee_id = t.rider_id OR referee_id = t.driver_id)
  LOOP
    v_role := NULL;

    IF rec.referee_id = t.rider_id THEN
      SELECT count(*) INTO v_prior
      FROM public.trips
      WHERE rider_id = rec.referee_id
        AND status = 'completed'
        AND id <> t.id;
      IF v_prior = 0 THEN
        v_role := 'rider';
      END IF;
    END IF;

    IF v_role IS NULL AND rec.referee_id = t.driver_id THEN
      SELECT count(*) INTO v_prior
      FROM public.trips
      WHERE driver_id = rec.referee_id
        AND status = 'completed'
        AND id <> t.id;
      IF v_prior = 0 THEN
        v_role := 'driver';
      END IF;
    END IF;

    IF v_role IS NULL THEN
      CONTINUE;
    END IF;

    SELECT id INTO v_locked
    FROM public.referrals
    WHERE id = rec.id
      AND status = 'pending'
    FOR UPDATE;

    IF v_locked IS NULL THEN
      CONTINUE;
    END IF;

    INSERT INTO public.credit_ledger (
      profile_id, amount_cents, reason, referral_id, trip_id, idempotency_key
    )
    VALUES
      (
        rec.referrer_id,
        p_referrer_cents,
        'referral_referrer',
        rec.id,
        t.id,
        'referral:' || rec.id::text || ':referrer'
      ),
      (
        rec.referee_id,
        p_referee_cents,
        'referral_referee',
        rec.id,
        t.id,
        'referral:' || rec.id::text || ':referee'
      )
    ON CONFLICT (idempotency_key) DO NOTHING;

    UPDATE public.referrals
    SET status = 'rewarded',
        qualify_role = v_role,
        qualifying_trip_id = t.id,
        rewarded_at = COALESCE(rewarded_at, now())
    WHERE id = rec.id
      AND status = 'pending';

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'referralId', rec.id,
        'role', v_role,
        'referrerCents', p_referrer_cents,
        'refereeCents', p_referee_cents
      )
    );
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'granted', v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.grant_referral_credits(uuid, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_referral_credits(uuid, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_trips_grant_referral_credits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed'
     AND NEW.driver_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    BEGIN
      PERFORM public.grant_referral_credits(NEW.id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'referral credit grant failed for trip %: %', NEW.id, SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_grant_referral_credits ON public.trips;
CREATE TRIGGER trips_grant_referral_credits
  AFTER INSERT OR UPDATE OF status ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_trips_grant_referral_credits();
