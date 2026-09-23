-- Rider-to-rider social promo codes (type = rider_social).
-- Separate from the general referral job (rider + driver first-completed-trip credits).
--
-- Conversion rule (locked):
--   Signup with a code stores profiles.referred_by + profiles.promo_code and a
--   rider_referrals row in status 'pending'. No credits are written at signup.
--   Rewards for BOTH the referrer and the new rider are inserted into credit_ledger
--   only after the referred user completes their first ride (trip status completed,
--   or a paid friend-ride seat on a completed trip). Idempotent.
--   States: pending → rewarded. Never auto-reward on signup.
--
-- ANTI-DOUBLE-DIP — one reward path per new user:
--   rider_referrals.referred_id is UNIQUE across every type.
--   This job writes type = 'rider_social' on promo_codes and rider_referrals.
--   Shared credit_ledger rows use source = 'social_promo' (allowed by
--   credit_ledger_source_check) and reason rider_social_referrer / rider_social_referred.
--   referral_id on credit_ledger stays null — that FK points at public.referrals,
--   which belongs to the general referral job.
--   One reward path per new user is public.signup_reward_grants (unique profile_id).
--   This grant calls claim_signup_reward(profile, 'social_promo', rider_referrals.id)
--   only when the first ride completes. If the general job already claimed 'referral',
--   this path does not insert credits.
--   Idempotency keys: rider_social:<referral id>:referrer|referred.
--
-- Defaults (change with the admin UPDATE at the bottom of this file):
--   referrer: $5.00 ride credit (500 cents)
--   new user: 20% of their first-ride fare as ride credit
--   fixed alternative stored but inactive: $5.00 when referred_discount_kind = 'fixed'
--
-- Admin query:
--   select * from public.rider_social_referral_report order by signed_up_at desc;
--   select * from public.rider_social_credit_report order by created_at desc;

-- ---------------------------------------------------------------------------
-- Profile attribution (set at signup claim only — not by the client)
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS promo_code text;

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_referred_by_not_self;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_referred_by_not_self
  CHECK (referred_by IS NULL OR referred_by <> id);

COMMENT ON COLUMN public.profiles.referred_by IS
  'Rider who shared the rider_social promo used at signup. Null if none. Not a reward.';
COMMENT ON COLUMN public.profiles.promo_code IS
  'rider_social code entered at signup. Rewards wait for the first completed ride.';

CREATE OR REPLACE FUNCTION public.protect_profile_referral_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF coalesce(current_setting('rider_social.internal', true), '') = '1' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.referred_by := NULL;
    NEW.promo_code := NULL;
    RETURN NEW;
  END IF;
  NEW.referred_by := OLD.referred_by;
  NEW.promo_code := OLD.promo_code;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_referral_fields ON public.profiles;
CREATE TRIGGER profiles_protect_referral_fields
  BEFORE INSERT OR UPDATE OF referred_by, promo_code ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_referral_fields();

-- ---------------------------------------------------------------------------
-- Configurable amounts
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.rider_referral_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL UNIQUE,
  referrer_credit_cents integer NOT NULL DEFAULT 500 CHECK (referrer_credit_cents >= 0),
  referred_discount_kind text NOT NULL DEFAULT 'percent'
    CHECK (referred_discount_kind = ANY (ARRAY['percent'::text, 'fixed'::text])),
  referred_percent_off integer NOT NULL DEFAULT 20
    CHECK (referred_percent_off >= 0 AND referred_percent_off <= 100),
  referred_cents_off integer NOT NULL DEFAULT 500 CHECK (referred_cents_off >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.rider_referral_config (
  type, referrer_credit_cents, referred_discount_kind, referred_percent_off, referred_cents_off
) VALUES (
  'rider_social', 500, 'percent', 20, 500
)
ON CONFLICT (type) DO NOTHING;

COMMENT ON TABLE public.rider_referral_config IS
  'Reward amounts for referral programs. rider_social: referrer ride credit + new-user first-ride discount (percent of fare or fixed cents), paid only after the first completed ride.';

-- ---------------------------------------------------------------------------
-- Codes + usage
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  type text NOT NULL DEFAULT 'rider_social',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS promo_codes_owner_type_uidx
  ON public.promo_codes (owner_id, type);

COMMENT ON TABLE public.promo_codes IS
  'Shareable codes. Rider social codes use type rider_social (one per rider).';

CREATE TABLE IF NOT EXISTS public.rider_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL DEFAULT 'rider_social',
  promo_code_id uuid REFERENCES public.promo_codes(id) ON DELETE SET NULL,
  code text NOT NULL,
  referrer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_id uuid NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
  referrer_first_name text NOT NULL DEFAULT 'Rider',
  referred_first_name text NOT NULL DEFAULT 'Rider',
  status text NOT NULL DEFAULT 'pending'
    CHECK (status = ANY (ARRAY['pending'::text, 'rewarded'::text])),
  trip_id uuid REFERENCES public.trips(id) ON DELETE SET NULL,
  referrer_reward_cents integer,
  referred_reward_cents integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  rewarded_at timestamptz
);

CREATE INDEX IF NOT EXISTS rider_referrals_referrer_idx
  ON public.rider_referrals (referrer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS rider_referrals_type_status_idx
  ON public.rider_referrals (type, status);

COMMENT ON TABLE public.rider_referrals IS
  'One row per new user (referred_id unique) so only one reward path can pay. rider_social stays pending until the first completed ride, then rewarded. Signup never sets rewarded.';

COMMENT ON COLUMN public.rider_referrals.referred_id IS
  'ANTI-DOUBLE-DIP: unique. If a row exists, do not pay a second new-user first-trip reward (any program).';

-- credit_ledger already exists (shared with the general referral job).
-- This job inserts source = 'social_promo', reason rider_social_*, idempotency_key
-- rider_social:<id>:referrer|referred, and referral_id NULL.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rider_first_name(p_full_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN btrim(coalesce(p_full_name, '')) = '' THEN 'Rider'
    WHEN position('@' IN p_full_name) > 0 THEN 'Rider'
    ELSE split_part(btrim(p_full_name), ' ', 1)
  END;
$$;

CREATE OR REPLACE FUNCTION public.rider_social_random_code(len integer DEFAULT 8)
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i integer;
BEGIN
  IF len IS NULL OR len < 4 THEN
    len := 8;
  END IF;
  FOR i IN 1..len LOOP
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  END LOOP;
  RETURN out;
END;
$$;

-- True when this profile already has a referral attribution (any type).
-- General referral job: skip its new-user first-trip credit when this is true.
CREATE OR REPLACE FUNCTION public.rider_has_social_referral(p_profile uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rider_referrals WHERE referred_id = p_profile
  );
$$;

CREATE OR REPLACE FUNCTION public.rider_first_completed_trip(p_uid uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id
  FROM (
    SELECT t.id, COALESCE(t.completed_at, t.requested_at) AS at
    FROM public.trips t
    WHERE t.rider_id = p_uid
      AND t.status = 'completed'
    UNION
    SELECT t.id, COALESCE(t.completed_at, t.requested_at) AS at
    FROM public.trips t
    JOIN public.friend_rides fr ON fr.trip_id = t.id
    JOIN public.friend_ride_participants p ON p.friend_ride_id = fr.id
    WHERE p.user_id = p_uid
      AND p.status = 'paid'
      AND t.status = 'completed'
  ) rides
  ORDER BY at ASC NULLS LAST, id ASC
  LIMIT 1;
$$;

-- ---------------------------------------------------------------------------
-- Signup claim: pending only. Does not write credit_ledger.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.claim_rider_social_promo(p_code text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  norm text;
  promo public.promo_codes%ROWTYPE;
  referred_name text;
  referrer_name text;
BEGIN
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sign in required');
  END IF;

  norm := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  IF char_length(norm) > 16 THEN
    norm := left(norm, 16);
  END IF;
  IF norm = '' THEN
    RETURN jsonb_build_object('ok', true, 'claimed', false, 'reason', 'no_code');
  END IF;

  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = uid AND referred_by IS NOT NULL)
     OR EXISTS (SELECT 1 FROM public.rider_referrals WHERE referred_id = uid) THEN
    RETURN jsonb_build_object('ok', true, 'claimed', false, 'reason', 'already_referred');
  END IF;

  IF public.rider_first_completed_trip(uid) IS NOT NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'Promo codes are only applied at signup, before your first completed ride.'
    );
  END IF;

  SELECT * INTO promo
  FROM public.promo_codes
  WHERE code = norm
    AND type = 'rider_social'
    AND active = true;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That promo code was not found.');
  END IF;

  IF promo.owner_id = uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You can''t use your own code.');
  END IF;

  PERFORM set_config('rider_social.internal', '1', true);

  UPDATE public.profiles
  SET referred_by = promo.owner_id,
      promo_code = promo.code,
      updated_at = now()
  WHERE id = uid
    AND referred_by IS NULL;

  IF NOT FOUND THEN
    IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid) THEN
      INSERT INTO public.profiles (id, email, full_name, referred_by, promo_code)
      SELECT
        u.id,
        u.email,
        NULLIF(btrim(coalesce(u.raw_user_meta_data->>'full_name', '')), ''),
        promo.owner_id,
        promo.code
      FROM auth.users u
      WHERE u.id = uid;
    ELSE
      RETURN jsonb_build_object('ok', true, 'claimed', false, 'reason', 'already_referred');
    END IF;
  END IF;

  SELECT public.rider_first_name(full_name) INTO referred_name
  FROM public.profiles WHERE id = uid;
  SELECT public.rider_first_name(full_name) INTO referrer_name
  FROM public.profiles WHERE id = promo.owner_id;

  INSERT INTO public.rider_referrals (
    type, promo_code_id, code, referrer_id, referred_id,
    referrer_first_name, referred_first_name, status
  ) VALUES (
    'rider_social', promo.id, promo.code, promo.owner_id, uid,
    coalesce(referrer_name, 'Rider'), coalesce(referred_name, 'Rider'), 'pending'
  );

  RETURN jsonb_build_object(
    'ok', true,
    'claimed', true,
    'status', 'pending',
    'code', promo.code
  );
EXCEPTION
  WHEN unique_violation THEN
    RETURN jsonb_build_object('ok', true, 'claimed', false, 'reason', 'already_referred');
END;
$$;

COMMENT ON FUNCTION public.claim_rider_social_promo(text) IS
  'Apply a rider_social code at signup. Writes referred_by / promo_code and status pending. Does not grant credits.';

CREATE OR REPLACE FUNCTION public.ensure_rider_social_code()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid := auth.uid();
  existing text;
  candidate text;
  i integer;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = uid) THEN
    RAISE EXCEPTION 'Profile not ready';
  END IF;

  SELECT code INTO existing
  FROM public.promo_codes
  WHERE owner_id = uid AND type = 'rider_social'
  LIMIT 1;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  FOR i IN 1..8 LOOP
    candidate := public.rider_social_random_code(8);
    BEGIN
      INSERT INTO public.promo_codes (code, owner_id, type, active)
      VALUES (candidate, uid, 'rider_social', true);
      RETURN candidate;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT code INTO existing
        FROM public.promo_codes
        WHERE owner_id = uid AND type = 'rider_social'
        LIMIT 1;
        IF existing IS NOT NULL THEN
          RETURN existing;
        END IF;
    END;
  END LOOP;

  RAISE EXCEPTION 'Could not create a referral code';
END;
$$;

-- ---------------------------------------------------------------------------
-- Grant once, only when this completed trip is the referred user's first ride.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.grant_rider_social_for_trip(p_trip_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  t public.trips%ROWTYPE;
  trip_uuid uuid;
  rider_uuid uuid;
  trip_fare integer;
  cand record;
  ref public.rider_referrals%ROWTYPE;
  cfg public.rider_referral_config%ROWTYPE;
  cfg_ok boolean := false;
  v_kind text;
  v_referrer integer;
  v_percent integer;
  v_fixed integer;
  first_id uuid;
  reward_referrer integer;
  reward_referred integer;
  updated_id uuid;
  granted integer := 0;
  v_claim jsonb;
BEGIN
  IF p_trip_id IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'granted', false, 'reason', 'no_trip');
  END IF;

  SELECT * INTO t FROM public.trips WHERE id = p_trip_id;
  IF NOT FOUND OR t.status IS DISTINCT FROM 'completed' THEN
    RETURN jsonb_build_object('ok', true, 'granted', false, 'reason', 'trip_not_completed');
  END IF;

  trip_uuid := t.id;
  rider_uuid := t.rider_id;
  trip_fare := COALESCE(t.fare_cents, 0);

  SELECT * INTO cfg FROM public.rider_referral_config WHERE type = 'rider_social';
  cfg_ok := FOUND;
  IF cfg_ok THEN
    v_kind := cfg.referred_discount_kind;
    v_referrer := cfg.referrer_credit_cents;
    v_percent := cfg.referred_percent_off;
    v_fixed := cfg.referred_cents_off;
  ELSE
    v_kind := 'percent';
    v_referrer := 500;
    v_percent := 20;
    v_fixed := 500;
  END IF;

  FOR cand IN
    SELECT q.uid, q.fare_cents
    FROM (
      SELECT DISTINCT ON (uid) uid, fare_cents
      FROM (
        SELECT rider_uuid AS uid, trip_fare AS fare_cents, 1 AS pref
        UNION ALL
        SELECT frp.user_id, COALESCE(frp.fare_cents, trip_fare, 0), 2
        FROM public.friend_rides fr
        JOIN public.friend_ride_participants frp ON frp.friend_ride_id = fr.id
        WHERE fr.trip_id = trip_uuid
          AND frp.user_id IS NOT NULL
          AND frp.status = 'paid'
      ) raw
      WHERE uid IS NOT NULL
      ORDER BY uid, pref DESC
    ) q
  LOOP
    SELECT * INTO ref
    FROM public.rider_referrals
    WHERE referred_id = cand.uid
      AND type = 'rider_social'
      AND status = 'pending'
    FOR UPDATE;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    -- Only the earliest completed ride may reward. Later trips no-op and leave
    -- pending so a retry of the first trip id can still grant once.
    first_id := public.rider_first_completed_trip(cand.uid);
    IF first_id IS DISTINCT FROM trip_uuid THEN
      CONTINUE;
    END IF;

    -- One reward path per new user. Do not reserve this at signup.
    v_claim := public.claim_signup_reward(cand.uid, 'social_promo', ref.id::text);
    IF COALESCE((v_claim->>'claimed')::boolean, false) IS NOT TRUE THEN
      UPDATE public.rider_referrals
      SET status = 'rewarded',
          rewarded_at = now(),
          trip_id = trip_uuid,
          referrer_reward_cents = 0,
          referred_reward_cents = 0
      WHERE id = ref.id
        AND status = 'pending';
      CONTINUE;
    END IF;

    IF v_kind = 'fixed' THEN
      reward_referred := GREATEST(coalesce(v_fixed, 0), 0);
    ELSE
      reward_referred := GREATEST(
        round(coalesce(cand.fare_cents, 0) * coalesce(v_percent, 0) / 100.0)::integer,
        0
      );
    END IF;
    reward_referrer := GREATEST(coalesce(v_referrer, 0), 0);

    UPDATE public.rider_referrals
    SET status = 'rewarded',
        rewarded_at = now(),
        trip_id = trip_uuid,
        referrer_reward_cents = reward_referrer,
        referred_reward_cents = reward_referred
    WHERE id = ref.id
      AND status = 'pending'
    RETURNING id INTO updated_id;

    IF updated_id IS NULL THEN
      CONTINUE;
    END IF;

    IF reward_referrer > 0 THEN
      INSERT INTO public.credit_ledger (
        profile_id, amount_cents, reason, referral_id, trip_id, idempotency_key, source
      ) VALUES (
        ref.referrer_id, reward_referrer, 'rider_social_referrer', NULL, trip_uuid,
        'rider_social:' || ref.id::text || ':referrer', 'social_promo'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    IF reward_referred > 0 THEN
      INSERT INTO public.credit_ledger (
        profile_id, amount_cents, reason, referral_id, trip_id, idempotency_key, source
      ) VALUES (
        ref.referred_id, reward_referred, 'rider_social_referred', NULL, trip_uuid,
        'rider_social:' || ref.id::text || ':referred', 'social_promo'
      )
      ON CONFLICT (idempotency_key) DO NOTHING;
    END IF;

    granted := granted + 1;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'granted', granted > 0, 'count', granted);
END;
$$;

COMMENT ON FUNCTION public.grant_rider_social_for_trip(uuid) IS
  'Idempotent. Pays rider_social rewards only if the trip is completed and it is the referred user''s first completed ride. No-op on signup, deposits, or a second call.';

CREATE OR REPLACE FUNCTION public.trg_trips_rider_social()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'completed') THEN
    BEGIN
      PERFORM public.grant_rider_social_for_trip(NEW.id);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'rider_social trip grant failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_rider_social_reward ON public.trips;
CREATE TRIGGER trips_rider_social_reward
  AFTER INSERT OR UPDATE OF status ON public.trips
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_trips_rider_social();

CREATE OR REPLACE FUNCTION public.trg_payments_rider_social()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'succeeded'
     AND NEW.trip_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM 'succeeded'
       OR OLD.trip_id IS DISTINCT FROM NEW.trip_id
     ) THEN
    BEGIN
      PERFORM public.grant_rider_social_for_trip(NEW.trip_id);
    EXCEPTION
      WHEN OTHERS THEN
        RAISE WARNING 'rider_social payment grant failed: %', SQLERRM;
    END;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_rider_social_reward ON public.payments;
CREATE TRIGGER payments_rider_social_reward
  AFTER INSERT OR UPDATE OF status, trip_id ON public.payments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_payments_rider_social();

-- ---------------------------------------------------------------------------
-- Admin / account queries (first names only — no email)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW public.rider_social_referral_report
WITH (security_invoker = true) AS
SELECT
  id,
  type,
  status,
  code,
  referrer_id,
  referred_id,
  referrer_first_name,
  referred_first_name,
  created_at AS signed_up_at,
  rewarded_at,
  trip_id,
  referrer_reward_cents,
  referred_reward_cents
FROM public.rider_referrals
WHERE type = 'rider_social';

COMMENT ON VIEW public.rider_social_referral_report IS
  'Admin query for rider_social usage and reward cents. First names only.';

CREATE OR REPLACE VIEW public.rider_social_credit_report
WITH (security_invoker = true) AS
SELECT
  id,
  profile_id,
  amount_cents,
  source,
  reason,
  trip_id,
  idempotency_key,
  created_at
FROM public.credit_ledger
WHERE source = 'social_promo'
  AND reason LIKE 'rider_social%';

COMMENT ON VIEW public.rider_social_credit_report IS
  'Admin query for rider_social credits on the shared ledger (source social_promo). No names or emails.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_referral_config ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.promo_codes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rider_referrals FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rider_referral_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rider_social_referral_report FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.rider_social_credit_report FROM PUBLIC, anon, authenticated;

GRANT SELECT ON public.promo_codes TO authenticated;
GRANT SELECT ON public.rider_referrals TO authenticated;
GRANT SELECT, UPDATE ON public.rider_referral_config TO authenticated;
GRANT SELECT ON public.rider_social_referral_report TO authenticated;
GRANT SELECT ON public.rider_social_credit_report TO authenticated;

DROP POLICY IF EXISTS credit_ledger_admin_select ON public.credit_ledger;
CREATE POLICY credit_ledger_admin_select ON public.credit_ledger
  FOR SELECT TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS promo_codes_select ON public.promo_codes;
CREATE POLICY promo_codes_select ON public.promo_codes
  FOR SELECT TO authenticated
  USING (owner_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS rider_referrals_select ON public.rider_referrals;
CREATE POLICY rider_referrals_select ON public.rider_referrals
  FOR SELECT TO authenticated
  USING (
    referrer_id = auth.uid()
    OR referred_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS rider_referral_config_select ON public.rider_referral_config;
CREATE POLICY rider_referral_config_select ON public.rider_referral_config
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS rider_referral_config_admin_update ON public.rider_referral_config;
CREATE POLICY rider_referral_config_admin_update ON public.rider_referral_config
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- No client INSERT/UPDATE on promo tables. Claims and grants use security definer functions.
-- credit_ledger keeps its existing select-own policy. Admins also have credit_ledger_admin_select.

REVOKE ALL ON FUNCTION public.claim_rider_social_promo(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.ensure_rider_social_code() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.grant_rider_social_for_trip(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rider_has_social_referral(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rider_first_completed_trip(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_trips_rider_social() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trg_payments_rider_social() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.claim_rider_social_promo(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_rider_social_code() TO authenticated;
GRANT EXECUTE ON FUNCTION public.grant_rider_social_for_trip(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rider_has_social_referral(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trg_trips_rider_social() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trg_payments_rider_social() TO authenticated, service_role;

-- Change amounts (admin, or service role). Example — referrer $5, new user 20%:
--   update public.rider_referral_config
--   set referrer_credit_cents = 500,
--       referred_discount_kind = 'percent',
--       referred_percent_off = 20,
--       referred_cents_off = 500,
--       updated_at = now()
--   where type = 'rider_social';
-- Fixed dollars for the new user instead of a percent:
--   update public.rider_referral_config
--   set referred_discount_kind = 'fixed', referred_cents_off = 500, updated_at = now()
--   where type = 'rider_social';
