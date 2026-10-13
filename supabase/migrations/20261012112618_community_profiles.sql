-- Campus community layer (privacy first). Additive.
--
-- community_profiles holds optional, opt-in fields per person. Every share_* flag
-- defaults to false. RLS: the owner alone can read, write, or delete their row.
-- No one else can select it, ever. The only cross-person read is community_matches(trip),
-- which returns matching CATEGORY lines ("Both from Greenville") for two people on the
-- same trip, and only for fields BOTH turned on. It never returns the other person's
-- values on their own, and courses come back as "Share a class" with no code or time.
-- Course entries are bare codes (e.g. CPSC 1010); sections and times are rejected.
-- Nothing in matching, pricing, or ETA reads this table.

CREATE TABLE IF NOT EXISTS public.community_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  hometown text CHECK (hometown IS NULL OR char_length(hometown) BETWEEN 2 AND 60),
  share_hometown boolean NOT NULL DEFAULT false,
  greek_org text CHECK (greek_org IS NULL OR char_length(greek_org) BETWEEN 2 AND 60),
  share_greek_org boolean NOT NULL DEFAULT false,
  major text CHECK (major IS NULL OR char_length(major) BETWEEN 2 AND 60),
  share_major boolean NOT NULL DEFAULT false,
  courses text[] NOT NULL DEFAULT '{}'::text[]
    CHECK (cardinality(courses) <= 8
      AND (cardinality(courses) = 0
        OR array_to_string(courses, ',') ~ '^[A-Z]{2,4} [0-9]{4}[A-Z]?(,[A-Z]{2,4} [0-9]{4}[A-Z]?)*$')),
  share_courses boolean NOT NULL DEFAULT false,
  grad_year integer CHECK (grad_year IS NULL OR grad_year BETWEEN 2000 AND 2040),
  share_grad_year boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.community_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_profiles FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS community_profiles_owner_select ON public.community_profiles;
CREATE POLICY community_profiles_owner_select ON public.community_profiles
  FOR SELECT TO authenticated USING (user_id = auth.uid());
DROP POLICY IF EXISTS community_profiles_owner_insert ON public.community_profiles;
CREATE POLICY community_profiles_owner_insert ON public.community_profiles
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS community_profiles_owner_update ON public.community_profiles;
CREATE POLICY community_profiles_owner_update ON public.community_profiles
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS community_profiles_owner_delete ON public.community_profiles;
CREATE POLICY community_profiles_owner_delete ON public.community_profiles
  FOR DELETE TO authenticated USING (user_id = auth.uid());
REVOKE ALL ON public.community_profiles FROM anon;
REVOKE ALL ON public.community_profiles FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.community_profiles TO authenticated;
GRANT ALL ON public.community_profiles TO service_role;

DROP TRIGGER IF EXISTS community_profiles_updated_at ON public.community_profiles;
CREATE TRIGGER community_profiles_updated_at BEFORE UPDATE ON public.community_profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.community_norm(p text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $$ SELECT nullif(lower(btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'))), '') $$;

CREATE OR REPLACE FUNCTION public.community_matches(p_trip_id uuid)
RETURNS TABLE (category text, label text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO 'off'
AS $function$
DECLARE
  v_me uuid := auth.uid();
  v_trip record;
  v_other uuid;
  a public.community_profiles%ROWTYPE;
  b public.community_profiles%ROWTYPE;
BEGIN
  IF v_me IS NULL OR p_trip_id IS NULL THEN RETURN; END IF;
  SELECT t.id, t.rider_id, t.driver_id, t.status::text AS status INTO v_trip FROM public.trips t WHERE t.id = p_trip_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF v_me = v_trip.rider_id THEN
    v_other := v_trip.driver_id;
  ELSIF v_me = v_trip.driver_id THEN
    v_other := v_trip.rider_id;
  ELSIF v_trip.driver_id IS NULL
    AND v_trip.status IN ('searching', 'offered', 'scheduled')
    AND EXISTS (SELECT 1 FROM public.driver_applications d WHERE d.profile_id = v_me AND d.status::text = 'approved') THEN
    -- An approved driver looking at an open offer for this ride.
    v_other := v_trip.rider_id;
  ELSE
    RETURN;
  END IF;
  IF v_other IS NULL OR v_other = v_me THEN RETURN; END IF;
  SELECT * INTO a FROM public.community_profiles WHERE user_id = v_me;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT * INTO b FROM public.community_profiles WHERE user_id = v_other;
  IF NOT FOUND THEN RETURN; END IF;

  IF a.share_hometown AND b.share_hometown AND public.community_norm(a.hometown) = public.community_norm(b.hometown) THEN
    category := 'hometown'; label := 'Both from ' || btrim(a.hometown); RETURN NEXT;
  END IF;
  IF a.share_greek_org AND b.share_greek_org AND public.community_norm(a.greek_org) = public.community_norm(b.greek_org) THEN
    category := 'greek_org'; label := 'Both in ' || btrim(a.greek_org); RETURN NEXT;
  END IF;
  IF a.share_major AND b.share_major AND public.community_norm(a.major) = public.community_norm(b.major) THEN
    category := 'major'; label := 'Both study ' || btrim(a.major); RETURN NEXT;
  END IF;
  IF a.share_courses AND b.share_courses AND a.courses && b.courses THEN
    category := 'courses'; label := 'Share a class'; RETURN NEXT;
  END IF;
  IF a.share_grad_year AND b.share_grad_year AND a.grad_year = b.grad_year THEN
    category := 'grad_year'; label := 'Both class of ' || a.grad_year::text; RETURN NEXT;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.community_matches(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.community_matches(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.community_matches(uuid) TO authenticated;

-- Down:
-- drop function if exists public.community_matches(uuid);
-- drop function if exists public.community_norm(text);
-- drop table if exists public.community_profiles;
