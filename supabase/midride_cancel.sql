-- Mid-ride cancel. Additive only.
-- Applied via Supabase MCP apply_migration name=trip_status_canceled_midride
-- Project: awktabuhijrshmsmagpq

ALTER TYPE public.trip_status ADD VALUE IF NOT EXISTS 'canceled_midride';

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_kind_check
  CHECK (kind = ANY (ARRAY[
    'deposit'::text,
    'balance'::text,
    'refund'::text,
    'friend_ride_share'::text,
    'midride_cancel'::text
  ]));
