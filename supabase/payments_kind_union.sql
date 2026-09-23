-- Apply this AFTER the held-feature SQL files.
-- Each of those files replaces payments_kind_check with its own list, so the
-- last one applied would reject kinds the others insert. This is the union
-- of every kind those files and the folded handlers write.

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_kind_check
  CHECK (kind = ANY (ARRAY[
    'deposit'::text,
    'balance'::text,
    'refund'::text,
    'friend_ride_share'::text,
    'tip'::text,
    'wait_fee'::text,
    'cancel_fee'::text,
    'cancellation_fee'::text,
    'midride_cancel'::text,
    'mid_ride'::text,
    'credit_purchase'::text,
    'credits_purchase'::text,
    'ride_fare'::text
  ]));
