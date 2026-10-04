-- A deadline belongs to a dispatch target, not to whether a client saw its card.
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS offer_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.set_matching_offer_deadline()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.status IN ('searching', 'offered') AND NEW.driver_id IS NULL
     AND NEW.metadata->>'kind' = 'driver_request'
     AND coalesce(NEW.deposit_cents, 0) = 0
     AND NEW.pickup_at IS NULL AND NEW.scheduled_for IS NULL
     AND coalesce(NEW.metadata->>'offer_driver_id', '') <> '' THEN
    IF TG_OP = 'INSERT' THEN
      NEW.offer_expires_at := clock_timestamp() + interval '60 seconds';
    ELSIF OLD.offer_expires_at IS NULL
       OR OLD.metadata->>'offer_driver_id' IS DISTINCT FROM NEW.metadata->>'offer_driver_id'
       OR OLD.status NOT IN ('searching', 'offered') THEN
      NEW.offer_expires_at := clock_timestamp() + interval '60 seconds';
    ELSE
      -- Seeing a card or updating unrelated metadata cannot extend the window.
      NEW.offer_expires_at := OLD.offer_expires_at;
    END IF;
  ELSE
    NEW.offer_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trips_matching_offer_deadline ON public.trips;
CREATE TRIGGER trips_matching_offer_deadline BEFORE INSERT OR UPDATE ON public.trips
FOR EACH ROW EXECUTE FUNCTION public.set_matching_offer_deadline();

-- Give existing eligible targeted rides a full window at rollout.
UPDATE public.trips SET offer_expires_at = NULL
WHERE status IN ('searching', 'offered') AND driver_id IS NULL
  AND metadata->>'kind' = 'driver_request'
  AND coalesce(metadata->>'offer_driver_id', '') <> ''
  AND coalesce(deposit_cents, 0) = 0
  AND pickup_at IS NULL AND scheduled_for IS NULL
  AND offer_expires_at IS NULL;

CREATE INDEX IF NOT EXISTS trips_matching_offer_due
ON public.trips (offer_expires_at, id)
WHERE offer_expires_at IS NOT NULL AND driver_id IS NULL
  AND status IN ('searching', 'offered');
