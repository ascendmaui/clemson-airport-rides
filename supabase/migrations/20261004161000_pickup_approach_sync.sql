-- Existing GPS publishers drive the approach phase for both rider clients.
-- Arrival stays driver-confirmed: arrived_at starts the existing wait timer.
CREATE OR REPLACE FUNCTION public.sync_pickup_approach()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.location_updated_at IS NULL
    OR NEW.location_updated_at < clock_timestamp() - interval '30 seconds'
    OR NEW.location_updated_at > clock_timestamp() + interval '30 seconds'
    OR NEW.lat IS NULL OR NEW.lng IS NULL
    OR NOT (NEW.lat BETWEEN -90 AND 90 AND NEW.lng BETWEEN -180 AND 180)
  THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.location_updated_at IS NOT NULL
      AND NEW.location_updated_at <= OLD.location_updated_at
    THEN RETURN NEW; END IF;
  END IF;

  -- A conditional UPDATE takes the trip row lock and rechecks status, so a
  -- concurrent cancel/start/arrival cannot be overwritten by a GPS update.
  -- Once approaching, GPS jitter never moves the trip backward to accepted.
  UPDATE public.trips t SET status = 'arriving'
  WHERE t.driver_id = NEW.driver_id
    AND t.status = 'accepted'
    AND t.pickup_lat BETWEEN -90 AND 90
    AND t.pickup_lng BETWEEN -180 AND 180
    AND 2 * 6371000 * asin(sqrt(least(1.0,
      power(sin(radians(t.pickup_lat - NEW.lat) / 2), 2)
      + cos(radians(NEW.lat)) * cos(radians(t.pickup_lat))
      * power(sin(radians(t.pickup_lng - NEW.lng) / 2), 2)
    ))) <= 500;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.sync_pickup_approach() FROM PUBLIC;
DROP TRIGGER IF EXISTS driver_location_pickup_approach ON public.driver_status;
CREATE TRIGGER driver_location_pickup_approach
AFTER INSERT OR UPDATE OF lat, lng, location_updated_at ON public.driver_status
FOR EACH ROW EXECUTE FUNCTION public.sync_pickup_approach();
