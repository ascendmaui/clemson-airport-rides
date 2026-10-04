-- Production trips.tier and vehicles.tier use the vehicle_tier enum; Tesla trips persist tier 'tesla'.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
             WHERE t.typname = 'vehicle_tier' AND n.nspname = 'public') THEN
    ALTER TYPE public.vehicle_tier ADD VALUE IF NOT EXISTS 'tesla';
  END IF;
END
$$;

-- Fleet eligibility does not change approval status or approval requirements.
CREATE OR REPLACE FUNCTION public.tesla_driver_eligible(p_driver uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.driver_applications a
    JOIN public.driver_status s ON s.driver_id = a.profile_id AND s.online IS TRUE
    JOIN public.vehicles v ON v.driver_id = a.profile_id
    WHERE a.profile_id = p_driver AND a.onboarding_status = 'approved'
      AND lower(trim(v.make)) = 'tesla' AND lower(trim(v.model)) ~ '^model\s*3$'
  );
$$;
REVOKE ALL ON FUNCTION public.tesla_driver_eligible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tesla_driver_eligible(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.tesla_fleet_available()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.driver_status s
    WHERE s.online IS TRUE AND public.tesla_driver_eligible(s.driver_id));
$$;
REVOKE ALL ON FUNCTION public.tesla_fleet_available() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tesla_fleet_available() TO anon, authenticated, service_role;

-- Protect API writes and direct/native accepts alike, including availability races.
CREATE OR REPLACE FUNCTION public.guard_tesla_trip()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE target uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.tier::text = 'tesla' AND NEW.tier IS DISTINCT FROM OLD.tier THEN
    RAISE EXCEPTION 'Tesla ride type cannot be changed after booking.';
  END IF;
  IF NEW.tier::text IS DISTINCT FROM 'tesla' THEN RETURN NEW; END IF;
  IF TG_OP = 'INSERT' OR NEW.tier IS DISTINCT FROM OLD.tier THEN
    IF NOT public.tesla_fleet_available() THEN
      RAISE EXCEPTION 'No approved Tesla Model 3 driver is online right now.';
    END IF;
  END IF;
  target := coalesce(NEW.driver_id, nullif(NEW.metadata->>'offer_driver_id', '')::uuid);
  IF target IS NOT NULL AND (TG_OP = 'INSERT' OR
      NEW.driver_id IS DISTINCT FROM OLD.driver_id OR
      NEW.metadata->>'offer_driver_id' IS DISTINCT FROM OLD.metadata->>'offer_driver_id' OR
      NEW.tier IS DISTINCT FROM OLD.tier) THEN
    IF NOT public.tesla_driver_eligible(target) THEN
      RAISE EXCEPTION 'This ride requires an approved, online Tesla Model 3 driver.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_tesla_trip() FROM PUBLIC;
DROP TRIGGER IF EXISTS trips_guard_tesla ON public.trips;
CREATE TRIGGER trips_guard_tesla BEFORE INSERT OR UPDATE ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.guard_tesla_trip();

-- Restrictive policy narrows existing driver offer policies, retaining party access.
DROP POLICY IF EXISTS tesla_fleet_offer_visibility ON public.trips;
CREATE POLICY tesla_fleet_offer_visibility ON public.trips AS RESTRICTIVE FOR SELECT TO authenticated
USING (tier::text IS DISTINCT FROM 'tesla' OR rider_id = auth.uid() OR driver_id = auth.uid()
  OR public.tesla_driver_eligible(auth.uid()));

-- Declines/offline releases use the same vehicle rule as initial dispatch.
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
  -- Stale passes must never move a newer target. Pool passes only record exclusion.
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
    AND (EXISTS (SELECT 1 FROM public.driver_applications da WHERE da.profile_id = ds.driver_id AND da.onboarding_status = 'approved')
      OR p.is_admin IS TRUE OR p.role::text IN ('admin', 'ops')
      OR lower(p.email) IN ('johnmatveev@gmail.com', 'johnmatveyev@gmail.com', 'jmat2019@icloud.com', 'john@gmail.com')
      OR EXISTS (SELECT 1 FROM public.admin_users a WHERE a.email = lower(p.email) AND a.access_role IN ('admin', 'support')))
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

