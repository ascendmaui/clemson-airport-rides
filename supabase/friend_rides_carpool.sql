-- Carpool track on friend_rides (applied via Supabase MCP apply_migration name=friend_rides_carpool_kind)
-- Project: awktabuhijrshmsmagpq

ALTER TABLE public.friend_rides
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'friends',
  ADD COLUMN IF NOT EXISTS driver_profile_id uuid REFERENCES public.profiles(id);

ALTER TABLE public.friend_rides DROP CONSTRAINT IF EXISTS friend_rides_kind_check;
ALTER TABLE public.friend_rides
  ADD CONSTRAINT friend_rides_kind_check
  CHECK (kind = ANY (ARRAY['friends'::text, 'carpool'::text]));

CREATE INDEX IF NOT EXISTS friend_rides_kind_idx ON public.friend_rides (kind);
CREATE INDEX IF NOT EXISTS friend_rides_driver_profile_id_idx ON public.friend_rides (driver_profile_id)
  WHERE driver_profile_id IS NOT NULL;

COMMENT ON COLUMN public.friend_rides.kind IS 'friends = passenger-organized; carpool = student-driver offering seats';
COMMENT ON COLUMN public.friend_rides.driver_profile_id IS 'Assigned driver for carpool (usually organizer)';
