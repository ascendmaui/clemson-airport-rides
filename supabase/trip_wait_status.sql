-- New trip statuses for the pickup wait clock.
-- Must be committed before supabase/trip_wait_fee.sql (enum values
-- cannot be used in the same transaction that adds them).

ALTER TYPE public.trip_status ADD VALUE IF NOT EXISTS 'arrived';
ALTER TYPE public.trip_status ADD VALUE IF NOT EXISTS 'cancelled_wait';
