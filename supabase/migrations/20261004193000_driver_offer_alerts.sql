-- Server record of a four-channel driver offer alert.
-- Service role writes it. Drivers do not read it from the client.
CREATE TABLE IF NOT EXISTS public.driver_offer_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  offer_marker text NOT NULL,
  channels jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT driver_offer_alerts_marker_unique UNIQUE (trip_id, driver_id, offer_marker)
);

ALTER TABLE public.driver_offer_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.driver_offer_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON TABLE public.driver_offer_alerts TO service_role;
