-- Auditable, per-channel delivery claim for driver-offer SMS and email.
CREATE TABLE IF NOT EXISTS public.driver_offer_alert_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid NOT NULL,
  driver_id uuid NOT NULL,
  offer_marker text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('sms', 'email')),
  status text NOT NULL,
  reason text,
  provider_message_id text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.driver_offer_alert_attempts ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS driver_offer_alert_attempts_dedupe
  ON public.driver_offer_alert_attempts (trip_id, driver_id, offer_marker, channel);
CREATE INDEX IF NOT EXISTS driver_offer_alert_attempts_rate_limit
  ON public.driver_offer_alert_attempts (driver_id, channel, created_at DESC);

REVOKE ALL ON TABLE public.driver_offer_alert_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.driver_offer_alert_attempts TO service_role;
