-- Platform 20/80 ledger, prepaid credit lots, surge quote fields.
-- Applied to project awktabuhijrshmsmagpq (Clemson Rides).

ALTER TABLE public.trips
  ADD COLUMN IF NOT EXISTS platform_fee_cents integer,
  ADD COLUMN IF NOT EXISTS driver_earnings_cents integer,
  ADD COLUMN IF NOT EXISTS surge_multiplier numeric,
  ADD COLUMN IF NOT EXISTS fare_breakdown jsonb;

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS platform_fee_cents integer,
  ADD COLUMN IF NOT EXISTS driver_earnings_cents integer,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_kind_check
  CHECK (kind = ANY (ARRAY[
    'deposit'::text,
    'balance'::text,
    'refund'::text,
    'friend_ride_share'::text,
    'tip'::text,
    'wait_fee'::text,
    'cancellation_fee'::text,
    'credit_purchase'::text,
    'ride_fare'::text
  ]));

ALTER TABLE public.ride_bills
  ADD COLUMN IF NOT EXISTS platform_fee_cents integer,
  ADD COLUMN IF NOT EXISTS driver_earnings_cents integer,
  ADD COLUMN IF NOT EXISTS discount_cents integer;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS credit_balance_cents integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.rider_credit_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  pack_id text NOT NULL,
  load_cents integer NOT NULL CHECK (load_cents > 0),
  discount_bps integer NOT NULL CHECK (discount_bps >= 0 AND discount_bps <= 10000),
  remaining_cents integer NOT NULL CHECK (remaining_cents >= 0),
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  status text NOT NULL DEFAULT 'available' CHECK (status = ANY (ARRAY['available'::text, 'exhausted'::text, 'void'::text])),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS rider_credit_lots_pi_uidx
  ON public.rider_credit_lots (stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS rider_credit_lots_profile_idx
  ON public.rider_credit_lots (profile_id, created_at);

CREATE TABLE IF NOT EXISTS public.rider_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lot_id uuid REFERENCES public.rider_credit_lots(id),
  kind text NOT NULL CHECK (kind = ANY (ARRAY['purchase'::text, 'redemption'::text, 'refund'::text])),
  amount_cents integer NOT NULL,
  discount_cents integer NOT NULL DEFAULT 0,
  trip_id uuid,
  payment_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS rider_credit_ledger_profile_idx
  ON public.rider_credit_ledger (profile_id, created_at);

ALTER TABLE public.rider_credit_lots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rider_credit_lots_select_own ON public.rider_credit_lots;
CREATE POLICY rider_credit_lots_select_own ON public.rider_credit_lots
  FOR SELECT USING (profile_id = auth.uid());

DROP POLICY IF EXISTS rider_credit_ledger_select_own ON public.rider_credit_ledger;
CREATE POLICY rider_credit_ledger_select_own ON public.rider_credit_ledger
  FOR SELECT USING (profile_id = auth.uid());

CREATE OR REPLACE FUNCTION public.refresh_rider_credit_balance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  pid uuid;
BEGIN
  pid := COALESCE(NEW.profile_id, OLD.profile_id);
  UPDATE public.profiles
  SET credit_balance_cents = (
    SELECT COALESCE(SUM(remaining_cents), 0)
    FROM public.rider_credit_lots
    WHERE profile_id = pid AND status = 'available'
  )
  WHERE id = pid;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS rider_credit_lots_balance ON public.rider_credit_lots;
CREATE TRIGGER rider_credit_lots_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.rider_credit_lots
  FOR EACH ROW EXECUTE FUNCTION public.refresh_rider_credit_balance();

COMMENT ON COLUMN public.trips.platform_fee_cents IS '20% of fare_cents (final rider price) — contractual platform share';
COMMENT ON COLUMN public.trips.driver_earnings_cents IS '80% of fare_cents — driver share of the final rider price';
COMMENT ON COLUMN public.payments.platform_fee_cents IS '20% of this charge. credit_purchase is liability and stays 0; 20% is taken when credits are redeemed.';
COMMENT ON COLUMN public.payments.driver_earnings_cents IS '80% of this charge (0 on credit_purchase).';
