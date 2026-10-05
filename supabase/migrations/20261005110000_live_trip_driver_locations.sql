-- Per-trip driver telemetry. This is intentionally separate from driver_status,
-- which is availability/dispatch state and must never power rider trip tracking.
CREATE TABLE IF NOT EXISTS public.trip_driver_locations (
  trip_id uuid PRIMARY KEY REFERENCES public.trips(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lat double precision NOT NULL CHECK (lat BETWEEN -90 AND 90),
  lng double precision NOT NULL CHECK (lng BETWEEN -180 AND 180),
  heading double precision CHECK (heading IS NULL OR heading BETWEEN 0 AND 360),
  speed double precision CHECK (speed IS NULL OR speed >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS trip_driver_locations_driver_id_idx ON public.trip_driver_locations(driver_id);
ALTER TABLE public.trip_driver_locations ENABLE ROW LEVEL SECURITY;

-- A driver can write only their assigned, active trip while they are on shift.
CREATE POLICY trip_driver_locations_driver_insert ON public.trip_driver_locations
  FOR INSERT TO authenticated WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.driver_id = auth.uid()
      AND t.status IN ('accepted'::public.trip_status, 'arriving'::public.trip_status, 'arrived'::public.trip_status, 'in_progress'::public.trip_status))
    AND EXISTS (SELECT 1 FROM public.driver_status s WHERE s.driver_id = auth.uid() AND s.online IS TRUE)
  );
CREATE POLICY trip_driver_locations_driver_update ON public.trip_driver_locations
  FOR UPDATE TO authenticated USING (driver_id = auth.uid()) WITH CHECK (
    driver_id = auth.uid()
    AND EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.driver_id = auth.uid()
      AND t.status IN ('accepted'::public.trip_status, 'arriving'::public.trip_status, 'arrived'::public.trip_status, 'in_progress'::public.trip_status))
    AND EXISTS (SELECT 1 FROM public.driver_status s WHERE s.driver_id = auth.uid() AND s.online IS TRUE)
  );

-- Riders can read exactly their assigned driver's active-trip row, and nobody else's.
CREATE POLICY trip_driver_locations_rider_read ON public.trip_driver_locations
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.trips t WHERE t.id = trip_id AND t.rider_id = auth.uid()
      AND t.driver_id = trip_driver_locations.driver_id
      AND t.status IN ('accepted'::public.trip_status, 'arriving'::public.trip_status, 'arrived'::public.trip_status, 'in_progress'::public.trip_status))
  );
CREATE POLICY trip_driver_locations_driver_read ON public.trip_driver_locations
  FOR SELECT TO authenticated USING (driver_id = auth.uid());

-- Realtime emits row changes, while RLS still governs what each subscriber can receive.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.trip_driver_locations;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
