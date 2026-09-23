-- Driver alerts, ride queue, tips, safety check-in, two-way standing.
-- Thresholds match src/lib/standing.js:
--   watch:       avg < 3.0 and count >= 3  (soft flag, still matchable)
--   restricted:  avg < 2.5 and count >= 5  (hidden from match; profiles.standing is the admin flag)

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS tip_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_tip_cents_nonneg;
ALTER TABLE public.trips ADD CONSTRAINT trips_tip_cents_nonneg CHECK (tip_cents >= 0);

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS safety_status text;
ALTER TABLE public.trips DROP CONSTRAINT IF EXISTS trips_safety_status_check;
ALTER TABLE public.trips ADD CONSTRAINT trips_safety_status_check
  CHECK (safety_status IS NULL OR safety_status = ANY (ARRAY['ok'::text, 'help'::text]));
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS safety_checked_at timestamptz;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_kind_check
  CHECK (kind = ANY (ARRAY['deposit'::text, 'balance'::text, 'refund'::text, 'friend_ride_share'::text, 'tip'::text]));

CREATE OR REPLACE FUNCTION public.protect_trip_tip_cents()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  jwt_role text;
BEGIN
  BEGIN
    jwt_role := current_setting('request.jwt.claim.role', true);
  EXCEPTION WHEN OTHERS THEN
    jwt_role := NULL;
  END;
  IF current_user IN ('service_role', 'postgres', 'supabase_admin')
     OR jwt_role IN ('service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  NEW.tip_cents := COALESCE(OLD.tip_cents, 0);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_protect_tip_cents ON public.trips;
CREATE TRIGGER trips_protect_tip_cents
  BEFORE UPDATE OF tip_cents ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.protect_trip_tip_cents();

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS standing text NOT NULL DEFAULT 'good';
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_standing_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_standing_check
  CHECK (standing = ANY (ARRAY['good'::text, 'watch'::text, 'restricted'::text]));
COMMENT ON COLUMN public.profiles.standing IS
  'good | watch (avg < 3.0, n>=3, soft flag) | restricted (avg < 2.5, n>=5, hidden from match)';

CREATE OR REPLACE FUNCTION public.profile_standing(avg numeric, cnt integer)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN COALESCE(cnt, 0) >= 5 AND COALESCE(avg, 0) < 2.5 THEN 'restricted'
    WHEN COALESCE(cnt, 0) >= 3 AND COALESCE(avg, 0) < 3.0 THEN 'watch'
    ELSE 'good'
  END
$$;

CREATE OR REPLACE FUNCTION public.refresh_profile_rating()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  avg numeric;
  cnt integer;
BEGIN
  SELECT ROUND(AVG(stars)::numeric, 2), COUNT(*)::int
    INTO avg, cnt
  FROM public.ratings r
  WHERE r.ratee_id = NEW.ratee_id;
  UPDATE public.profiles p
  SET rating_avg = COALESCE(avg, 0),
      rating_count = COALESCE(cnt, 0),
      standing = public.profile_standing(COALESCE(avg, 0), COALESCE(cnt, 0)),
      updated_at = now()
  WHERE p.id = NEW.ratee_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_profile_rating_stats()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  target uuid;
  avg numeric;
  cnt integer;
BEGIN
  target := COALESCE(NEW.ratee_id, OLD.ratee_id);
  SELECT ROUND(AVG(r.stars)::numeric, 2), COUNT(*)::int
    INTO avg, cnt
  FROM public.ratings r
  WHERE r.ratee_id = target;
  UPDATE public.profiles p
  SET rating_avg = COALESCE(avg, 0),
      rating_count = COALESCE(cnt, 0),
      standing = public.profile_standing(COALESCE(avg, 0), COALESCE(cnt, 0)),
      updated_at = now()
  WHERE p.id = target;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP POLICY IF EXISTS ratings_insert_completed ON public.ratings;
DROP POLICY IF EXISTS ratings_insert_party ON public.ratings;
CREATE POLICY ratings_insert_party ON public.ratings
  FOR INSERT TO authenticated
  WITH CHECK (
    rater_id = auth.uid()
    AND stars >= 1 AND stars <= 5
    AND EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_id
        AND t.status = 'completed'::public.trip_status
        AND (
          (t.rider_id = auth.uid() AND t.driver_id = ratee_id)
          OR (t.driver_id = auth.uid() AND t.rider_id = ratee_id)
        )
    )
  );

DROP POLICY IF EXISTS trips_online_driver_claim ON public.trips;
CREATE POLICY trips_online_driver_claim ON public.trips
  FOR UPDATE TO authenticated
  USING (
    status IN ('searching'::public.trip_status, 'offered'::public.trip_status)
    AND driver_id IS NULL
    AND EXISTS (
      SELECT 1 FROM public.driver_status ds
      WHERE ds.driver_id = auth.uid() AND ds.online = true
    )
  )
  WITH CHECK (
    driver_id = auth.uid()
    AND status IN ('accepted'::public.trip_status, 'offered'::public.trip_status)
  );

DROP POLICY IF EXISTS trips_driver_progress ON public.trips;
CREATE POLICY trips_driver_progress ON public.trips
  FOR UPDATE TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (
    driver_id = auth.uid()
    AND status IN (
      'accepted'::public.trip_status,
      'arriving'::public.trip_status,
      'in_progress'::public.trip_status,
      'completed'::public.trip_status,
      'canceled'::public.trip_status
    )
  );

DROP POLICY IF EXISTS trip_events_online_driver_insert ON public.trip_events;
CREATE POLICY trip_events_online_driver_insert ON public.trip_events
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_events.trip_id
        AND (
          t.driver_id = auth.uid()
          OR t.rider_id = auth.uid()
          OR (
            t.status IN ('searching'::public.trip_status, 'offered'::public.trip_status)
            AND t.driver_id IS NULL
            AND EXISTS (
              SELECT 1 FROM public.driver_status ds
              WHERE ds.driver_id = auth.uid() AND ds.online = true
            )
          )
        )
    )
  );

CREATE TABLE IF NOT EXISTS public.driver_ride_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  queue_position smallint NOT NULL CHECK (queue_position BETWEEN 1 AND 2),
  status text NOT NULL DEFAULT 'queued' CHECK (status = ANY (ARRAY['queued'::text, 'promoted'::text, 'canceled'::text])),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, trip_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS driver_ride_queue_open_position
  ON public.driver_ride_queue (driver_id, queue_position)
  WHERE status = 'queued';

ALTER TABLE public.driver_ride_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_ride_queue_select ON public.driver_ride_queue;
CREATE POLICY driver_ride_queue_select ON public.driver_ride_queue
  FOR SELECT TO authenticated
  USING (
    driver_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.rider_id = auth.uid())
  );

DROP POLICY IF EXISTS driver_ride_queue_insert ON public.driver_ride_queue;
CREATE POLICY driver_ride_queue_insert ON public.driver_ride_queue
  FOR INSERT TO authenticated
  WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_id AND t.driver_id = auth.uid() AND t.status = 'accepted'::public.trip_status
    )
  );

DROP POLICY IF EXISTS driver_ride_queue_update ON public.driver_ride_queue;
CREATE POLICY driver_ride_queue_update ON public.driver_ride_queue
  FOR UPDATE TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.driver_offer_passes (
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  trip_id uuid NOT NULL REFERENCES public.trips(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, trip_id)
);

ALTER TABLE public.driver_offer_passes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_offer_passes_own ON public.driver_offer_passes;
CREATE POLICY driver_offer_passes_own ON public.driver_offer_passes
  FOR ALL TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.driver_ride_queue TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.driver_offer_passes TO authenticated;

-- Clients must not rewrite aggregates or the admin standing flag.
-- Rating triggers run as the function owner, so auth.uid() is the rater (not the ratee)
-- and this freeze does not undo those updates.
CREATE OR REPLACE FUNCTION public.protect_profile_standing()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND coalesce(auth.role(), '') = 'authenticated'
     AND auth.uid() IS NOT NULL
     AND auth.uid() = NEW.id THEN
    NEW.standing := OLD.standing;
    NEW.rating_avg := OLD.rating_avg;
    NEW.rating_count := OLD.rating_count;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_standing ON public.profiles;
CREATE TRIGGER profiles_protect_standing
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_standing();

UPDATE public.profiles
SET standing = public.profile_standing(rating_avg, rating_count)
WHERE rating_count > 0;
