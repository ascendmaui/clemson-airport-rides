-- Support tickets for the Account → Support agent.
-- Users can read and insert their own rows. The serverless agent writes with the service role.
-- Apply on project awktabuhijrshmsmagpq before ticket filing will succeed.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  role_variant text NOT NULL CHECK (role_variant IN ('rider', 'driver')),
  category text NOT NULL CHECK (category IN ('bug', 'billing', 'ride_dispute', 'account', 'safety', 'other')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 4 AND 140),
  body text NOT NULL CHECK (char_length(body) BETWEEN 8 AND 4000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_tickets_user_created_idx
  ON public.support_tickets (user_id, created_at DESC);

DROP TRIGGER IF EXISTS support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_tickets_select_own ON public.support_tickets;
CREATE POLICY support_tickets_select_own
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS support_tickets_insert_own ON public.support_tickets;
CREATE POLICY support_tickets_insert_own
  ON public.support_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

GRANT SELECT, INSERT ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;
