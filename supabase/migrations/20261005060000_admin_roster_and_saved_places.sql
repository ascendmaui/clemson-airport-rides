-- Remove unknown admin addresses and store saved places per account.
-- Apply on project awktabuhijrshmsmagpq. This file does not write production by itself.
-- john@gmail.com and johnmatveev@gmail.com are not owner accounts.

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    lower(coalesce(auth.jwt() ->> 'email', '')) NOT IN ('john@gmail.com', 'johnmatveev@gmail.com')
    AND NOT EXISTS (
      SELECT 1
      FROM public.profiles denied
      WHERE denied.id = auth.uid()
        AND lower(coalesce(denied.email, '')) IN ('john@gmail.com', 'johnmatveev@gmail.com')
    )
    AND (
      EXISTS (
        SELECT 1
        FROM public.admin_users a
        WHERE a.access_role = 'admin'
          AND a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
      )
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND (
            p.is_admin IS TRUE
            OR p.role::text IN ('admin', 'ops')
            OR lower(coalesce(p.email, '')) IN (
              SELECT email FROM public.admin_users WHERE access_role = 'admin'
            )
          )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.is_incentive_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin();
$$;

CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  seeded boolean := EXISTS (
    SELECT 1 FROM public.admin_users a
    WHERE a.access_role = 'admin' AND a.email = jwt_email
  );
  privileged boolean := public.is_service_role() OR public.is_admin() OR seeded;
BEGIN
  IF jwt_email IN ('john@gmail.com', 'johnmatveev@gmail.com') THEN
    NEW.is_admin := false;
    IF NEW.role::text IN ('admin', 'ops') THEN
      NEW.role := 'rider';
    END IF;
    RETURN NEW;
  END IF;

  IF seeded THEN
    NEW.is_admin := true;
    NEW.role := 'admin';
    RETURN NEW;
  END IF;

  IF privileged THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_admin := false;
    IF NEW.role::text IN ('admin', 'ops') THEN
      NEW.role := 'rider';
    END IF;
    RETURN NEW;
  END IF;

  NEW.is_admin := OLD.is_admin;
  IF NEW.role::text IN ('admin', 'ops') AND NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.role := OLD.role;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'profiles_protect_privileges'
      AND tgrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles DISABLE TRIGGER profiles_protect_privileges;
  END IF;
END $$;

DELETE FROM public.admin_users
WHERE email IN ('john@gmail.com', 'johnmatveev@gmail.com');

INSERT INTO public.admin_users (email, access_role, note)
VALUES
  ('johnmatveyev@gmail.com', 'admin', 'Owner'),
  ('ascendmaui@gmail.com', 'admin', 'Owner'),
  ('jmat2019@icloud.com', 'admin', 'Owner')
ON CONFLICT (email) DO UPDATE
SET access_role = EXCLUDED.access_role,
    note = EXCLUDED.note;

UPDATE public.profiles
SET is_admin = false,
    role = 'rider'
WHERE lower(coalesce(email, '')) IN ('john@gmail.com', 'johnmatveev@gmail.com')
  AND (is_admin IS TRUE OR role::text IN ('admin', 'ops'));

UPDATE public.profiles
SET is_admin = true,
    role = 'admin'
WHERE lower(coalesce(email, '')) = 'ascendmaui@gmail.com';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'profiles_protect_privileges'
      AND tgrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ENABLE TRIGGER profiles_protect_privileges;
  END IF;
END $$;

-- Offer eligibility keeps the current dispatch rules. Unknown admin addresses
-- are not an admin bypass. Approved drivers are unchanged.
CREATE OR REPLACE FUNCTION public.release_matching_offer(p_trip uuid, p_driver uuid, p_reason text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  t public.trips;
  candidate uuid;
  skipped jsonb;
BEGIN
  SELECT * INTO t FROM public.trips WHERE id = p_trip FOR UPDATE;
  IF t.id IS NULL OR t.status::text NOT IN ('searching', 'offered')
     OR t.driver_id IS NOT NULL OR t.pickup_at IS NOT NULL OR t.scheduled_for IS NOT NULL
     OR coalesce(t.deposit_cents, 0) <> 0
     OR t.metadata->>'kind' IS DISTINCT FROM 'driver_request' THEN RETURN; END IF;
  IF nullif(t.metadata->>'offer_driver_id', '') IS DISTINCT FROM p_driver::text THEN RETURN; END IF;
  skipped := coalesce(t.metadata->'offer_passed_driver_ids', '[]'::jsonb);
  IF NOT skipped ? p_driver::text THEN skipped := skipped || to_jsonb(p_driver::text); END IF;
  SELECT ds.driver_id INTO candidate
  FROM public.driver_status ds
  JOIN public.profiles p ON p.id = ds.driver_id
  WHERE ds.online IS TRUE AND ds.driver_id <> p_driver
    AND ds.driver_id IS DISTINCT FROM t.rider_id
    AND NOT skipped ? ds.driver_id::text
    AND NOT coalesce(t.metadata->'offer_tried_driver_ids', '[]'::jsonb) ? ds.driver_id::text
    AND NOT EXISTS (SELECT 1 FROM public.driver_offer_passes op WHERE op.trip_id = t.id AND op.driver_id = ds.driver_id)
    AND (
      EXISTS (SELECT 1 FROM public.driver_applications da WHERE da.profile_id = ds.driver_id AND da.onboarding_status = 'approved')
      OR (
        lower(p.email) NOT IN ('john@gmail.com', 'johnmatveev@gmail.com')
        AND (
          p.is_admin IS TRUE OR p.role::text IN ('admin', 'ops')
          OR lower(p.email) IN ('johnmatveyev@gmail.com', 'ascendmaui@gmail.com', 'jmat2019@icloud.com')
          OR EXISTS (SELECT 1 FROM public.admin_users a WHERE a.email = lower(p.email) AND a.access_role IN ('admin', 'support'))
        )
      )
    )
    AND (t.tier::text IS DISTINCT FROM 'tesla' OR public.tesla_driver_eligible(ds.driver_id))
  ORDER BY coalesce((SELECT ord FROM jsonb_array_elements_text(coalesce(t.metadata->'auto_assign_queue', '[]'::jsonb)) WITH ORDINALITY q(id, ord) WHERE q.id = ds.driver_id::text LIMIT 1), 2147483647),
    CASE lower(p.email) WHEN 'johnmatveyev@gmail.com' THEN 0 WHEN 'kimubermaui@gmail.com' THEN 1 ELSE 2 END, ds.driver_id
  LIMIT 1 FOR UPDATE OF ds SKIP LOCKED;
  UPDATE public.trips SET status = 'searching', metadata = t.metadata || jsonb_build_object(
    'offer_driver_id', candidate, 'match', CASE WHEN candidate IS NULL THEN 'open' ELSE 'auto' END,
    'offer_passed_driver_ids', skipped,
    'offer_tried_driver_ids', coalesce(t.metadata->'offer_tried_driver_ids', '[]'::jsonb) || to_jsonb(p_driver::text), 'offer_release_reason', p_reason, 'offer_released_at', now())
  WHERE id = t.id AND driver_id IS NULL AND status::text IN ('searching', 'offered');
END;
$$;
REVOKE ALL ON FUNCTION public.release_matching_offer(uuid, uuid, text) FROM PUBLIC;

CREATE TABLE IF NOT EXISTS public.saved_places (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  label text NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 80),
  subtitle text NOT NULL CHECK (char_length(btrim(subtitle)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS saved_places_user_idx
  ON public.saved_places (user_id, created_at);

ALTER TABLE public.saved_places ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.saved_places FROM PUBLIC;
REVOKE ALL ON public.saved_places FROM anon;

DROP POLICY IF EXISTS saved_places_select_own ON public.saved_places;
CREATE POLICY saved_places_select_own
  ON public.saved_places
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS saved_places_insert_own ON public.saved_places;
CREATE POLICY saved_places_insert_own
  ON public.saved_places
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS saved_places_update_own ON public.saved_places;
CREATE POLICY saved_places_update_own
  ON public.saved_places
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS saved_places_delete_own ON public.saved_places;
CREATE POLICY saved_places_delete_own
  ON public.saved_places
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.saved_places TO authenticated;
GRANT ALL ON public.saved_places TO service_role;
