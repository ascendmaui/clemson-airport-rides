-- Fare dispute summaries. One row per disputed trip, written by the service role
-- (/api/trip-messages?action=dispute). Rider, driver on the trip, and admins can read.
-- Additive only.

CREATE TABLE IF NOT EXISTS public.trip_dispute_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL REFERENCES public.trips (id) ON DELETE CASCADE,
  ticket_id uuid REFERENCES public.support_tickets (id) ON DELETE SET NULL,
  opened_by uuid REFERENCES public.profiles (id) ON DELETE SET NULL,
  opened_role text NOT NULL CHECK (opened_role IN ('rider', 'driver', 'admin')),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 1000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary_text text NOT NULL DEFAULT '',
  generated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT trip_dispute_summaries_trip_key UNIQUE (trip_id)
);

CREATE INDEX IF NOT EXISTS trip_dispute_summaries_ticket_idx ON public.trip_dispute_summaries (ticket_id);

DROP TRIGGER IF EXISTS trip_dispute_summaries_updated_at ON public.trip_dispute_summaries;
CREATE TRIGGER trip_dispute_summaries_updated_at
  BEFORE UPDATE ON public.trip_dispute_summaries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.trip_dispute_summaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trip_dispute_summaries_read ON public.trip_dispute_summaries;
CREATE POLICY trip_dispute_summaries_read ON public.trip_dispute_summaries
  FOR SELECT TO authenticated
  USING (
    public.is_admin()
    OR EXISTS (
      SELECT 1 FROM public.trips t
      WHERE t.id = trip_dispute_summaries.trip_id
        AND (t.rider_id = auth.uid() OR t.driver_id = auth.uid())
    )
  );

GRANT SELECT ON public.trip_dispute_summaries TO authenticated;
GRANT ALL ON public.trip_dispute_summaries TO service_role;
