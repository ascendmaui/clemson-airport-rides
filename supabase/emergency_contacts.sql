-- Rider emergency contacts. Additive only.
-- Native rider Safety screen add/edit/list uses this table.
-- Same rider-owned RLS shape as other account rows (support_tickets).

CREATE TABLE IF NOT EXISTS public.emergency_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text NOT NULL,
  relationship text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT emergency_contacts_name_len CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  CONSTRAINT emergency_contacts_phone_len CHECK (char_length(btrim(phone)) BETWEEN 7 AND 20),
  CONSTRAINT emergency_contacts_relationship_len CHECK (
    relationship IS NULL OR char_length(btrim(relationship)) BETWEEN 1 AND 40
  )
);

COMMENT ON TABLE public.emergency_contacts IS
  'People a rider can call from Safety and SOS. One list per profile, max 5.';

CREATE INDEX IF NOT EXISTS emergency_contacts_user_idx
  ON public.emergency_contacts (user_id, created_at);

CREATE OR REPLACE FUNCTION public.emergency_contacts_limit()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF (
    SELECT count(*)
    FROM public.emergency_contacts
    WHERE user_id = NEW.user_id
  ) >= 5 THEN
    RAISE EXCEPTION 'You can save up to 5 emergency contacts';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS emergency_contacts_limit ON public.emergency_contacts;
CREATE TRIGGER emergency_contacts_limit
  BEFORE INSERT ON public.emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION public.emergency_contacts_limit();

DROP TRIGGER IF EXISTS emergency_contacts_updated_at ON public.emergency_contacts;
CREATE TRIGGER emergency_contacts_updated_at
  BEFORE UPDATE ON public.emergency_contacts
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.emergency_contacts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.emergency_contacts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.emergency_contacts TO authenticated;
GRANT ALL ON TABLE public.emergency_contacts TO service_role;

DROP POLICY IF EXISTS emergency_contacts_select_own ON public.emergency_contacts;
CREATE POLICY emergency_contacts_select_own
  ON public.emergency_contacts
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS emergency_contacts_insert_own ON public.emergency_contacts;
CREATE POLICY emergency_contacts_insert_own
  ON public.emergency_contacts
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS emergency_contacts_update_own ON public.emergency_contacts;
CREATE POLICY emergency_contacts_update_own
  ON public.emergency_contacts
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS emergency_contacts_delete_own ON public.emergency_contacts;
CREATE POLICY emergency_contacts_delete_own
  ON public.emergency_contacts
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
