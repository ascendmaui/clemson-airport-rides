-- Client inserts and updates cannot set the fare that Stripe or settlement
-- treats as owed. Service role (checkout, schedule-trip, airport checkout)
-- writes fare_cents and deposit_cents. Authenticated clients may still insert
-- a trip that leaves those columns null.

CREATE OR REPLACE FUNCTION public.protect_trip_fare_cents()
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
  IF TG_OP = 'INSERT' THEN
    IF NEW.fare_cents IS NOT NULL OR NEW.deposit_cents IS NOT NULL THEN
      RAISE EXCEPTION 'fare_cents is set by the server';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.fare_cents IS DISTINCT FROM OLD.fare_cents
     OR NEW.deposit_cents IS DISTINCT FROM OLD.deposit_cents THEN
    RAISE EXCEPTION 'fare_cents is set by the server';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_protect_fare_cents ON public.trips;
DROP TRIGGER IF EXISTS trips_protect_fare_cents_insert ON public.trips;
DROP TRIGGER IF EXISTS trips_protect_fare_cents_update ON public.trips;
CREATE TRIGGER trips_protect_fare_cents_insert
  BEFORE INSERT ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.protect_trip_fare_cents();
CREATE TRIGGER trips_protect_fare_cents_update
  BEFORE UPDATE OF fare_cents, deposit_cents ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.protect_trip_fare_cents();
