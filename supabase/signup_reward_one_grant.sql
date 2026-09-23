-- Incremental: one welcome grant per new user, shared with rider-to-rider social promo.
-- Applied after referrals_credit_ledger. Fresh installs get the same objects from that file.

ALTER TABLE public.referrals ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE public.credit_ledger ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'referral';
ALTER TABLE public.credit_ledger DROP CONSTRAINT IF EXISTS credit_ledger_source_check;
ALTER TABLE public.credit_ledger
  ADD CONSTRAINT credit_ledger_source_check
  CHECK (source = ANY (ARRAY['referral'::text, 'social_promo'::text]));

COMMENT ON TABLE public.credit_ledger IS
  'Shared platform reward ledger for referral credits and rider-to-rider social promo credits. Not purchased packs (those live in rider_credit_lots / rider_credit_ledger). One welcome grant per new user is enforced by signup_reward_grants.';

-- One reward grant per new user across referral and rider-to-rider social promo.
-- The first system to claim this row pays. The other pays nothing for that signup.
CREATE TABLE IF NOT EXISTS public.signup_reward_grants (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  source text NOT NULL
    CHECK (source = ANY (ARRAY['referral'::text, 'social_promo'::text])),
  source_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.signup_reward_grants IS
  'One reward grant per new user across systems. General referral (rider or driver, first completed trip) and rider-to-rider social promo must call claim_signup_reward before writing welcome credits. The first claim wins and pays its own parties. The other system must not pay the new user or its referrer for that signup. Write those credits to public.credit_ledger. Do not write welcome credits into rider_credit_ledger (purchased prepaid packs).';

ALTER TABLE public.signup_reward_grants ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS signup_reward_select_own ON public.signup_reward_grants;
CREATE POLICY signup_reward_select_own
  ON public.signup_reward_grants
  FOR SELECT
  TO authenticated
  USING (auth.uid() = profile_id);

REVOKE ALL ON public.signup_reward_grants FROM anon, authenticated;
GRANT SELECT ON public.signup_reward_grants TO authenticated;
GRANT ALL ON public.signup_reward_grants TO service_role;

CREATE OR REPLACE FUNCTION public.claim_signup_reward(
  p_profile_id uuid,
  p_source text,
  p_source_ref text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source text;
  v_ref text;
BEGIN
  IF p_profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'profile_required');
  END IF;
  IF p_source IS NULL OR p_source NOT IN ('referral', 'social_promo') THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_source');
  END IF;

  INSERT INTO public.signup_reward_grants (profile_id, source, source_ref)
  VALUES (p_profile_id, p_source, p_source_ref)
  ON CONFLICT (profile_id) DO NOTHING;

  SELECT source, source_ref
  INTO v_source, v_ref
  FROM public.signup_reward_grants
  WHERE profile_id = p_profile_id;

  IF v_source IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'claim_failed');
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'claimed', v_source = p_source AND v_ref IS NOT DISTINCT FROM p_source_ref,
    'source', v_source,
    'sourceRef', v_ref
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_signup_reward(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_signup_reward(uuid, text, text) TO service_role;

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
  v_claim jsonb;
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

    -- One reward grant per new user. Social promo may already own this signup.
    v_claim := public.claim_signup_reward(rec.referee_id, 'referral', rec.id::text);
    IF COALESCE((v_claim->>'claimed')::boolean, false) IS NOT TRUE THEN
      UPDATE public.referrals
      SET status = 'void',
          void_reason = 'signup_already_rewarded:' || COALESCE(v_claim->>'source', 'unknown'),
          rewarded_at = COALESCE(rewarded_at, now())
      WHERE id = rec.id
        AND status = 'pending';

      v_results := v_results || jsonb_build_array(
        jsonb_build_object(
          'referralId', rec.id,
          'skipped', true,
          'reason', 'signup_already_rewarded',
          'existingSource', v_claim->>'source'
        )
      );
      CONTINUE;
    END IF;

    INSERT INTO public.credit_ledger (
      profile_id, amount_cents, reason, referral_id, trip_id, idempotency_key, source
    )
    VALUES
      (
        rec.referrer_id,
        p_referrer_cents,
        'referral_referrer',
        rec.id,
        t.id,
        'referral:' || rec.id::text || ':referrer',
        'referral'
      ),
      (
        rec.referee_id,
        p_referee_cents,
        'referral_referee',
        rec.id,
        t.id,
        'referral:' || rec.id::text || ':referee',
        'referral'
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
