-- Presence changes must not make an old GPS fix look current. Existing rows
-- intentionally remain unknown until the driver sends a fresh location.
ALTER TABLE public.driver_status ADD COLUMN IF NOT EXISTS location_updated_at timestamptz;
