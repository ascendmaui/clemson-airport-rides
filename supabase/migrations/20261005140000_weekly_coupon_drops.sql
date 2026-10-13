-- One row per Friday noon ET coupon drop. The cron claims drop_key before emailing.
-- Apply on the Vercel/Supabase project before the first live Friday send.

CREATE TABLE IF NOT EXISTS public.weekly_coupon_drops (
  drop_key text PRIMARY KEY,
  coupon_id text NOT NULL,
  code text NOT NULL,
  concept_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.weekly_coupon_drops IS
  'Idempotency claim for the Friday 12:00 America/New_York coupon email and push.';

ALTER TABLE public.weekly_coupon_drops ENABLE ROW LEVEL SECURITY;
