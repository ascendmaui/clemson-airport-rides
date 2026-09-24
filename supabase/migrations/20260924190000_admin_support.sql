-- Admin accounts, in-app notifications, applicant messages, and support-bot tickets.
-- Apply on project awktabuhijrshmsmagpq AFTER driver_onboarding_approval.sql
-- and supabase/migrations/20260923120000_support_tickets.sql.
-- Service role writes bot and admin replies. RLS never uses USING (true).

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.admin_users (
  email text PRIMARY KEY,
  access_role text NOT NULL CHECK (access_role IN ('admin', 'support')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.admin_users (email, access_role, note)
VALUES
  ('johnmatveev@gmail.com', 'admin', 'Seeded admin'),
  ('johnmatveyev@gmail.com', 'admin', 'Seeded admin — alternate spelling'),
  ('jmat2019@icloud.com', 'admin', 'Seeded admin'),
  ('john@gmail.com', 'admin', 'Existing production admin. Kept so that sign-in is not locked out.')
ON CONFLICT (email) DO UPDATE
SET access_role = EXCLUDED.access_role,
    note = EXCLUDED.note;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_users_select_admin ON public.admin_users;
CREATE POLICY admin_users_select_admin
  ON public.admin_users
  FOR SELECT
  TO authenticated
  USING (
    lower(coalesce(auth.jwt() ->> 'email', '')) = email
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (p.is_admin IS TRUE OR p.role::text IN ('admin', 'ops'))
    )
  );

GRANT SELECT ON public.admin_users TO authenticated;
GRANT ALL ON public.admin_users TO service_role;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    EXISTS (
      SELECT 1
      FROM public.admin_users a
      WHERE a.access_role = 'admin'
        AND a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND (
          p.is_admin IS TRUE
          OR p.role::text IN ('admin', 'ops')
          OR lower(coalesce(p.email, '')) IN (
            SELECT email FROM public.admin_users WHERE access_role = 'admin'
          )
        )
    );
$$;

CREATE OR REPLACE FUNCTION public.is_support_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin()
    OR EXISTS (
      SELECT 1
      FROM public.admin_users a
      WHERE a.access_role = 'support'
        AND a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
    );
$$;

REVOKE ALL ON FUNCTION public.is_admin() FROM public;
REVOKE ALL ON FUNCTION public.is_support_staff() FROM public;
GRANT EXECUTE ON FUNCTION public.is_admin() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_support_staff() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.protect_profile_privileges()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  jwt_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  seeded boolean := EXISTS (
    SELECT 1 FROM public.admin_users a
    WHERE a.access_role = 'admin' AND a.email = jwt_email
  );
  privileged boolean := public.is_service_role() OR public.is_admin() OR seeded;
BEGIN
  IF seeded THEN
    NEW.is_admin := true;
    NEW.role := 'admin';
    RETURN NEW;
  END IF;

  IF privileged THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.is_admin := false;
    IF NEW.role::text IN ('admin', 'ops') THEN
      NEW.role := 'rider';
    END IF;
    RETURN NEW;
  END IF;

  NEW.is_admin := OLD.is_admin;
  IF NEW.role::text IN ('admin', 'ops') AND NEW.role IS DISTINCT FROM OLD.role THEN
    NEW.role := OLD.role;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'profiles_protect_privileges'
      AND tgrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles DISABLE TRIGGER profiles_protect_privileges;
  END IF;
END $$;

UPDATE public.profiles p
SET is_admin = true,
    role = 'admin'
WHERE lower(coalesce(p.email, '')) IN (
  SELECT email FROM public.admin_users WHERE access_role = 'admin'
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgname = 'profiles_protect_privileges'
      AND tgrelid = 'public.profiles'::regclass
  ) THEN
    ALTER TABLE public.profiles ENABLE TRIGGER profiles_protect_privileges;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.is_incentive_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.is_admin();
$$;

CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('driver_application', 'support_escalation', 'info_request', 'other')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 140),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  entity_type text,
  entity_id text,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_notifications_created_idx
  ON public.admin_notifications (created_at DESC);

ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_notifications_select_admin ON public.admin_notifications;
CREATE POLICY admin_notifications_select_admin
  ON public.admin_notifications
  FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS admin_notifications_update_admin ON public.admin_notifications;
CREATE POLICY admin_notifications_update_admin
  ON public.admin_notifications
  FOR UPDATE
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

GRANT SELECT, UPDATE ON public.admin_notifications TO authenticated;
GRANT ALL ON public.admin_notifications TO service_role;

CREATE OR REPLACE FUNCTION public.guard_admin_notification_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.kind := OLD.kind;
  NEW.title := OLD.title;
  NEW.body := OLD.body;
  NEW.entity_type := OLD.entity_type;
  NEW.entity_id := OLD.entity_id;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_notifications_guard ON public.admin_notifications;
CREATE TRIGGER admin_notifications_guard
  BEFORE UPDATE ON public.admin_notifications
  FOR EACH ROW EXECUTE FUNCTION public.guard_admin_notification_update();

CREATE OR REPLACE FUNCTION public.notify_admin_driver_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  who text;
BEGIN
  IF NEW.onboarding_status IS DISTINCT FROM 'pending_review' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.onboarding_status = 'pending_review' THEN
    RETURN NEW;
  END IF;

  SELECT coalesce(nullif(p.full_name, ''), nullif(p.email, ''), 'A driver')
    INTO who
  FROM public.profiles p
  WHERE p.id = NEW.profile_id;

  INSERT INTO public.admin_notifications (kind, title, body, entity_type, entity_id)
  VALUES (
    'driver_application',
    'New driver application',
    coalesce(who, 'A driver') || ' submitted an application for review.',
    'driver_application',
    NEW.profile_id::text
  );
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.driver_applications') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS driver_applications_admin_notify ON public.driver_applications;
    CREATE TRIGGER driver_applications_admin_notify
      AFTER INSERT OR UPDATE OF onboarding_status ON public.driver_applications
      FOR EACH ROW EXECUTE FUNCTION public.notify_admin_driver_application();
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.driver_application_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.profiles (id),
  author_role text NOT NULL CHECK (author_role IN ('admin', 'applicant', 'system')),
  kind text NOT NULL DEFAULT 'message' CHECK (kind IN ('message', 'info_request')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  email_stub text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS driver_application_messages_profile_idx
  ON public.driver_application_messages (profile_id, created_at);

ALTER TABLE public.driver_application_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_application_messages_select ON public.driver_application_messages;
CREATE POLICY driver_application_messages_select
  ON public.driver_application_messages
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS driver_application_messages_insert_applicant ON public.driver_application_messages;
CREATE POLICY driver_application_messages_insert_applicant
  ON public.driver_application_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    profile_id = auth.uid()
    AND author_id = auth.uid()
    AND author_role = 'applicant'
    AND kind = 'message'
  );

GRANT SELECT, INSERT ON public.driver_application_messages TO authenticated;
GRANT ALL ON public.driver_application_messages TO service_role;

CREATE TABLE IF NOT EXISTS public.driver_info_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  requested_by uuid REFERENCES public.profiles (id),
  prompt text NOT NULL CHECK (char_length(prompt) BETWEEN 4 AND 2000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fulfilled', 'cancelled')),
  email_stub text,
  emailed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  fulfilled_at timestamptz
);

CREATE INDEX IF NOT EXISTS driver_info_requests_profile_idx
  ON public.driver_info_requests (profile_id, created_at DESC);

ALTER TABLE public.driver_info_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS driver_info_requests_select ON public.driver_info_requests;
CREATE POLICY driver_info_requests_select
  ON public.driver_info_requests
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid() OR public.is_admin());

GRANT SELECT ON public.driver_info_requests TO authenticated;
GRANT ALL ON public.driver_info_requests TO service_role;

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  role_variant text NOT NULL CHECK (role_variant IN ('rider', 'driver')),
  category text NOT NULL CHECK (category IN ('bug', 'billing', 'ride_dispute', 'account', 'safety', 'other')),
  subject text NOT NULL CHECK (char_length(subject) BETWEEN 4 AND 140),
  body text NOT NULL CHECK (char_length(body) BETWEEN 8 AND 4000),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'bot_handling', 'waiting_user', 'escalated', 'resolved')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  bot_intent text,
  bot_confidence numeric,
  escalation_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.support_tickets
  ADD COLUMN IF NOT EXISTS bot_intent text,
  ADD COLUMN IF NOT EXISTS bot_confidence numeric,
  ADD COLUMN IF NOT EXISTS escalation_reason text;

DO $$
DECLARE
  existing_name text;
BEGIN
  FOR existing_name IN
    SELECT con.conname
    FROM pg_constraint con
    WHERE con.conrelid = 'public.support_tickets'::regclass
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.support_tickets DROP CONSTRAINT %I', existing_name);
  END LOOP;
END $$;

UPDATE public.support_tickets
SET status = 'bot_handling'
WHERE status = 'in_progress';

ALTER TABLE public.support_tickets
  ADD CONSTRAINT support_tickets_status_check
  CHECK (status IN ('open', 'bot_handling', 'waiting_user', 'escalated', 'resolved'));

DROP POLICY IF EXISTS support_tickets_select_staff ON public.support_tickets;
CREATE POLICY support_tickets_select_staff
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (public.is_support_staff());

CREATE TABLE IF NOT EXISTS public.support_ticket_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id uuid NOT NULL REFERENCES public.support_tickets (id) ON DELETE CASCADE,
  author_id uuid REFERENCES public.profiles (id),
  author_role text NOT NULL CHECK (author_role IN ('user', 'bot', 'admin', 'support')),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_ticket_messages_ticket_idx
  ON public.support_ticket_messages (ticket_id, created_at);

ALTER TABLE public.support_ticket_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_ticket_messages_select ON public.support_ticket_messages;
CREATE POLICY support_ticket_messages_select
  ON public.support_ticket_messages
  FOR SELECT
  TO authenticated
  USING (
    public.is_support_staff()
    OR EXISTS (
      SELECT 1
      FROM public.support_tickets t
      WHERE t.id = ticket_id
        AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS support_ticket_messages_insert_user ON public.support_ticket_messages;
CREATE POLICY support_ticket_messages_insert_user
  ON public.support_ticket_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    author_role = 'user'
    AND author_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.support_tickets t
      WHERE t.id = ticket_id
        AND t.user_id = auth.uid()
    )
  );

GRANT SELECT, INSERT ON public.support_ticket_messages TO authenticated;
GRANT ALL ON public.support_ticket_messages TO service_role;
