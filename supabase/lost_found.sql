-- Lost and found. Additive only — does not alter or drop existing tables.
-- Statuses: open, claimed, returned, closed.
-- open → claimed when the other party confirms found
-- open → closed when the other party says not found, or the reporter withdraws
-- claimed → returned when either party marks the item handed back
-- claimed|returned → closed when either party closes the report

CREATE TABLE IF NOT EXISTS public.lost_found_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips (id) ON DELETE CASCADE,
  reporter_id uuid NOT NULL REFERENCES public.profiles (id),
  counterpart_id uuid NOT NULL REFERENCES public.profiles (id),
  item_description text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  resolution text,
  support_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  returned_at timestamptz,
  closed_at timestamptz,
  CONSTRAINT lost_found_reports_parties_distinct CHECK (reporter_id <> counterpart_id),
  CONSTRAINT lost_found_reports_status_check CHECK (
    status = ANY (ARRAY['open'::text, 'claimed'::text, 'returned'::text, 'closed'::text])
  ),
  CONSTRAINT lost_found_reports_resolution_check CHECK (
    resolution IS NULL OR resolution = ANY (ARRAY['found'::text, 'not_found'::text])
  ),
  CONSTRAINT lost_found_reports_item_len CHECK (char_length(btrim(item_description)) BETWEEN 2 AND 400),
  CONSTRAINT lost_found_reports_note_len CHECK (support_note IS NULL OR char_length(support_note) <= 1000)
);

CREATE TABLE IF NOT EXISTS public.lost_found_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id uuid NOT NULL REFERENCES public.lost_found_reports (id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES public.profiles (id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lost_found_messages_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 1000)
);

CREATE INDEX IF NOT EXISTS lost_found_reports_reporter_idx
  ON public.lost_found_reports (reporter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lost_found_reports_counterpart_idx
  ON public.lost_found_reports (counterpart_id, created_at DESC);
CREATE INDEX IF NOT EXISTS lost_found_reports_trip_idx
  ON public.lost_found_reports (trip_id);
CREATE INDEX IF NOT EXISTS lost_found_reports_status_idx
  ON public.lost_found_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS lost_found_messages_report_idx
  ON public.lost_found_messages (report_id, created_at);

DROP TRIGGER IF EXISTS lost_found_reports_updated_at ON public.lost_found_reports;
CREATE TRIGGER lost_found_reports_updated_at
  BEFORE UPDATE ON public.lost_found_reports
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.lost_found_can_report(p_trip uuid, p_reporter uuid, p_counterpart uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_reporter = auth.uid()
    AND p_reporter IS DISTINCT FROM p_counterpart
    AND EXISTS (
      SELECT 1
      FROM public.trips t
      WHERE t.id = p_trip
        AND t.status = 'completed'
        AND t.driver_id IS NOT NULL
        AND (
          (t.rider_id = p_reporter AND t.driver_id = p_counterpart)
          OR (t.driver_id = p_reporter AND t.rider_id = p_counterpart)
        )
    );
$$;

REVOKE ALL ON FUNCTION public.lost_found_can_report(uuid, uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lost_found_can_report(uuid, uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.lost_found_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  actor uuid := auth.uid();
  admin boolean := public.is_admin();
BEGIN
  IF actor IS NULL AND NOT admin THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.trip_id IS DISTINCT FROM OLD.trip_id
     OR NEW.reporter_id IS DISTINCT FROM OLD.reporter_id
     OR NEW.counterpart_id IS DISTINCT FROM OLD.counterpart_id
     OR NEW.item_description IS DISTINCT FROM OLD.item_description
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'immutable lost and found fields';
  END IF;

  IF NOT admin AND actor IS DISTINCT FROM OLD.reporter_id AND actor IS DISTINCT FROM OLD.counterpart_id THEN
    RAISE EXCEPTION 'not a party to this report';
  END IF;

  IF NEW.support_note IS NOT NULL THEN
    NEW.support_note := btrim(NEW.support_note);
    IF NEW.support_note = '' THEN
      NEW.support_note := NULL;
    END IF;
  END IF;

  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    IF NEW.resolution IS DISTINCT FROM OLD.resolution
       OR NEW.claimed_at IS DISTINCT FROM OLD.claimed_at
       OR NEW.returned_at IS DISTINCT FROM OLD.returned_at
       OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
    THEN
      RAISE EXCEPTION 'invalid status transition';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'invalid status transition';
  END IF;

  IF OLD.status = 'open' AND NEW.status = 'claimed' THEN
    IF NOT admin AND actor IS DISTINCT FROM OLD.counterpart_id THEN
      RAISE EXCEPTION 'only the other party can confirm found';
    END IF;
    NEW.resolution := 'found';
    NEW.claimed_at := COALESCE(OLD.claimed_at, now());
    RETURN NEW;
  END IF;

  IF OLD.status = 'open' AND NEW.status = 'closed' THEN
    NEW.closed_at := COALESCE(OLD.closed_at, now());
    IF admin THEN
      RETURN NEW;
    END IF;
    IF actor = OLD.counterpart_id THEN
      NEW.resolution := 'not_found';
      RETURN NEW;
    END IF;
    IF actor = OLD.reporter_id THEN
      NEW.resolution := OLD.resolution;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'invalid status transition';
  END IF;

  IF OLD.status = 'claimed' AND NEW.status = 'returned' THEN
    NEW.resolution := 'found';
    NEW.claimed_at := OLD.claimed_at;
    NEW.returned_at := COALESCE(OLD.returned_at, now());
    RETURN NEW;
  END IF;

  IF OLD.status = 'claimed' AND NEW.status = 'closed' THEN
    NEW.resolution := COALESCE(OLD.resolution, 'found');
    NEW.claimed_at := OLD.claimed_at;
    NEW.closed_at := COALESCE(OLD.closed_at, now());
    RETURN NEW;
  END IF;

  IF OLD.status = 'returned' AND NEW.status = 'closed' THEN
    NEW.resolution := COALESCE(OLD.resolution, 'found');
    NEW.claimed_at := OLD.claimed_at;
    NEW.returned_at := OLD.returned_at;
    NEW.closed_at := COALESCE(OLD.closed_at, now());
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'invalid status transition';
END;
$$;

REVOKE ALL ON FUNCTION public.lost_found_guard_update() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lost_found_guard_update() TO authenticated;

DROP TRIGGER IF EXISTS lost_found_reports_guard ON public.lost_found_reports;
CREATE TRIGGER lost_found_reports_guard
  BEFORE UPDATE ON public.lost_found_reports
  FOR EACH ROW EXECUTE FUNCTION public.lost_found_guard_update();

CREATE OR REPLACE FUNCTION public.lost_found_seed_claim_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'open' AND NEW.status = 'claimed' THEN
    INSERT INTO public.lost_found_messages (report_id, sender_id, body)
    VALUES (
      NEW.id,
      NEW.counterpart_id,
      'Found it. Use this thread to arrange the return.'
    );
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.lost_found_seed_claim_message() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lost_found_seed_claim_message() TO authenticated;

DROP TRIGGER IF EXISTS lost_found_reports_seed_message ON public.lost_found_reports;
CREATE TRIGGER lost_found_reports_seed_message
  AFTER UPDATE ON public.lost_found_reports
  FOR EACH ROW EXECUTE FUNCTION public.lost_found_seed_claim_message();

ALTER TABLE public.lost_found_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lost_found_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lost_found_reports_select ON public.lost_found_reports;
CREATE POLICY lost_found_reports_select ON public.lost_found_reports
  FOR SELECT TO authenticated
  USING (
    reporter_id = auth.uid()
    OR counterpart_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS lost_found_reports_insert ON public.lost_found_reports;
CREATE POLICY lost_found_reports_insert ON public.lost_found_reports
  FOR INSERT TO authenticated
  WITH CHECK (
    public.lost_found_can_report(trip_id, reporter_id, counterpart_id)
    AND status = 'open'
    AND resolution IS NULL
    AND claimed_at IS NULL
    AND returned_at IS NULL
    AND closed_at IS NULL
  );

DROP POLICY IF EXISTS lost_found_reports_update ON public.lost_found_reports;
CREATE POLICY lost_found_reports_update ON public.lost_found_reports
  FOR UPDATE TO authenticated
  USING (
    reporter_id = auth.uid()
    OR counterpart_id = auth.uid()
    OR public.is_admin()
  )
  WITH CHECK (
    reporter_id = auth.uid()
    OR counterpart_id = auth.uid()
    OR public.is_admin()
  );

DROP POLICY IF EXISTS lost_found_messages_select ON public.lost_found_messages;
CREATE POLICY lost_found_messages_select ON public.lost_found_messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.lost_found_reports r
      WHERE r.id = lost_found_messages.report_id
        AND (
          r.reporter_id = auth.uid()
          OR r.counterpart_id = auth.uid()
          OR public.is_admin()
        )
    )
  );

DROP POLICY IF EXISTS lost_found_messages_insert ON public.lost_found_messages;
CREATE POLICY lost_found_messages_insert ON public.lost_found_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    sender_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.lost_found_reports r
      WHERE r.id = report_id
        AND r.status IN ('claimed', 'returned')
        AND (r.reporter_id = auth.uid() OR r.counterpart_id = auth.uid())
    )
  );

GRANT SELECT, INSERT, UPDATE ON public.lost_found_reports TO authenticated;
GRANT SELECT, INSERT ON public.lost_found_messages TO authenticated;

ALTER TABLE public.lost_found_reports REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'lost_found_reports'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.lost_found_reports;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
