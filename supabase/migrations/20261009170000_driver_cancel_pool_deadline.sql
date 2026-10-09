-- Re-dispatching an accepted pool trip must start a fresh expiry window.
-- Acceptance clears the deadline but retains offer_phase=pool; preserving that
-- null deadline on return to searching would strand the trip and its fare hold.
CREATE OR REPLACE FUNCTION public.set_matching_offer_deadline()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  phase text;
  targeted boolean;
  eligible boolean;
BEGIN
  phase := coalesce(NEW.metadata->>'offer_phase', '');
  targeted := coalesce(NEW.metadata->>'offer_driver_id', '') <> '';
  eligible := NEW.status IN ('searching', 'offered') AND NEW.driver_id IS NULL
     AND NEW.metadata->>'kind' = 'driver_request'
     AND coalesce(NEW.deposit_cents, 0) = 0
     AND NEW.pickup_at IS NULL AND NEW.scheduled_for IS NULL;

  IF eligible AND phase = 'pool' THEN
    IF TG_OP = 'INSERT'
       OR coalesce(OLD.metadata->>'offer_phase', '') IS DISTINCT FROM 'pool'
       OR OLD.status NOT IN ('searching', 'offered')
       OR OLD.driver_id IS NOT NULL THEN
      NEW.offer_expires_at := clock_timestamp() + interval '2 minutes';
    ELSE
      NEW.offer_expires_at := OLD.offer_expires_at;
    END IF;
  ELSIF eligible AND targeted THEN
    IF TG_OP = 'INSERT' THEN
      NEW.offer_expires_at := clock_timestamp() + interval '15 seconds';
    ELSIF OLD.offer_expires_at IS NULL
       OR OLD.metadata->>'offer_driver_id' IS DISTINCT FROM NEW.metadata->>'offer_driver_id'
       OR OLD.status NOT IN ('searching', 'offered') THEN
      NEW.offer_expires_at := clock_timestamp() + interval '15 seconds';
    ELSE
      NEW.offer_expires_at := OLD.offer_expires_at;
    END IF;
  ELSE
    NEW.offer_expires_at := NULL;
  END IF;
  RETURN NEW;
END;
$$;

-- Down: restore the previous pool branch condition
--   IF TG_OP = 'INSERT'
--      OR coalesce(OLD.metadata->>'offer_phase', '') IS DISTINCT FROM 'pool' THEN
-- (i.e. drop the two added "OLD.status NOT IN ('searching','offered')" / "OLD.driver_id IS NOT NULL" conditions).
