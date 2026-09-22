-- Applied via Supabase MCP apply_migration name=friend_rides_mvp_extend
-- Project: awktabuhijrshmsmagpq

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_kind_check
  CHECK (kind = ANY (ARRAY['deposit'::text, 'balance'::text, 'refund'::text, 'friend_ride_share'::text]));

ALTER TABLE public.payments ALTER COLUMN trip_id DROP NOT NULL;

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS stops jsonb DEFAULT '[]'::jsonb;
ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

CREATE UNIQUE INDEX IF NOT EXISTS friend_ride_participants_ride_email_uidx
  ON public.friend_ride_participants (friend_ride_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS friend_rides_updated_at ON public.friend_rides;
CREATE TRIGGER friend_rides_updated_at
  BEFORE UPDATE ON public.friend_rides
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS friend_ride_participants_updated_at ON public.friend_ride_participants;
CREATE TRIGGER friend_ride_participants_updated_at
  BEFORE UPDATE ON public.friend_ride_participants
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
