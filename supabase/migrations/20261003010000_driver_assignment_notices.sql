-- Driver-only assignment notices and browser push subscriptions.
-- Riders have no policies on these tables.

CREATE TABLE IF NOT EXISTS public.driver_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind = 'ride_assigned'),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  trip_id uuid REFERENCES public.trips (id) ON DELETE CASCADE,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_notifications_driver_idx
  ON public.driver_notifications (driver_id, created_at DESC);

ALTER TABLE public.driver_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_notifications_select_own ON public.driver_notifications;
CREATE POLICY driver_notifications_select_own
  ON public.driver_notifications
  FOR SELECT
  TO authenticated
  USING (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_notifications_update_own ON public.driver_notifications;
CREATE POLICY driver_notifications_update_own
  ON public.driver_notifications
  FOR UPDATE
  TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

GRANT SELECT, UPDATE ON public.driver_notifications TO authenticated;
GRANT ALL ON public.driver_notifications TO service_role;

CREATE TABLE IF NOT EXISTS public.driver_web_push (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_web_push_driver_idx
  ON public.driver_web_push (driver_id);

ALTER TABLE public.driver_web_push ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_web_push_select_own ON public.driver_web_push;
CREATE POLICY driver_web_push_select_own
  ON public.driver_web_push
  FOR SELECT
  TO authenticated
  USING (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_web_push_insert_own ON public.driver_web_push;
CREATE POLICY driver_web_push_insert_own
  ON public.driver_web_push
  FOR INSERT
  TO authenticated
  WITH CHECK (driver_id = auth.uid());

DROP POLICY IF EXISTS driver_web_push_update_own ON public.driver_web_push;
CREATE POLICY driver_web_push_update_own
  ON public.driver_web_push
  FOR UPDATE
  TO authenticated
  USING (driver_id = auth.uid())
  WITH CHECK (driver_id = auth.uid());

GRANT SELECT, INSERT, UPDATE ON public.driver_web_push TO authenticated;
GRANT ALL ON public.driver_web_push TO service_role;

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.driver_notifications;
EXCEPTION
  WHEN duplicate_object OR undefined_object THEN
    NULL;
END $$;
