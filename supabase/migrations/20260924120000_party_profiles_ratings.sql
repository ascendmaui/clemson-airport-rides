-- Profiles required for riders and drivers, plus mutual 1–5 star ratings.
-- Counterpart SELECT is limited to accepted (and later) trips.
-- rating_avg / rating_count refresh from ratings. Clients cannot write those columns
-- (profiles_protect_standing in driver_alerts_queue_tips.sql).

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS bio text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS phone text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS ride_style text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS music_taste text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS favorite_spots jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS profile_privacy text NOT NULL DEFAULT 'matched';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rating_avg numeric;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS rating_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS standing text NOT NULL DEFAULT 'good';

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

CREATE TABLE IF NOT EXISTS public.ratings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips (id) ON DELETE CASCADE,
  rater_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  ratee_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  stars smallint NOT NULL CHECK (stars BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 280),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ratings_not_self CHECK (rater_id <> ratee_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS ratings_trip_rater_uidx
  ON public.ratings (trip_id, rater_id);

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

DROP TRIGGER IF EXISTS ratings_refresh_profile ON public.ratings;
CREATE TRIGGER ratings_refresh_profile
  AFTER INSERT OR UPDATE OR DELETE ON public.ratings
  FOR EACH ROW EXECUTE FUNCTION public.refresh_profile_rating_stats();

ALTER TABLE public.ratings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ratings_select_party ON public.ratings;
CREATE POLICY ratings_select_party ON public.ratings
  FOR SELECT TO authenticated
  USING (
    rater_id = auth.uid()
    OR ratee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = ratings.trip_id
        AND (t.rider_id = auth.uid() OR t.driver_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS ratings_insert_party ON public.ratings;
CREATE POLICY ratings_insert_party ON public.ratings
  FOR INSERT TO authenticated
  WITH CHECK (
    rater_id = auth.uid()
    AND stars >= 1 AND stars <= 5
    AND rater_id <> ratee_id
    AND EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_id
        AND t.status::text = 'completed'
        AND (
          (t.rider_id = auth.uid() AND t.driver_id = ratee_id)
          OR (t.driver_id = auth.uid() AND t.rider_id = ratee_id)
        )
    )
  );

-- Safe columns only. A row policy on profiles would also expose billing fields.
CREATE OR REPLACE FUNCTION public.counterpart_profile(target uuid)
RETURNS TABLE (
  id uuid,
  full_name text,
  avatar_url text,
  bio text,
  ride_style text,
  favorite_spots jsonb,
  music_taste text,
  rating_avg numeric,
  rating_count integer,
  student_verified_at timestamptz,
  phone text,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    p.id,
    p.full_name,
    p.avatar_url,
    p.bio,
    p.ride_style,
    to_jsonb(p.favorite_spots) AS favorite_spots,
    p.music_taste,
    p.rating_avg,
    p.rating_count,
    p.student_verified_at,
    p.phone,
    p.role
  FROM public.profiles p
  WHERE p.id = target
    AND (
      p.id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.trips t
        WHERE t.status::text = ANY (ARRAY['accepted', 'arriving', 'arrived', 'in_progress', 'completed'])
          AND (
            (t.rider_id = auth.uid() AND t.driver_id = p.id)
            OR (t.driver_id = auth.uid() AND t.rider_id = p.id)
          )
      )
    );
$$;

REVOKE ALL ON FUNCTION public.counterpart_profile(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.counterpart_profile(uuid) TO authenticated;

GRANT SELECT, INSERT ON public.ratings TO authenticated;
