-- Payment failure hardening. Idempotent. Apply in Supabase; do not drop existing data.
-- Extends payment kinds, credit wallet, payout queue, and blocks unpaid complete/cancel.

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
    'mid_ride'::text,
    'credits_purchase'::text
  ]));

ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS idempotency_key text;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS payments_idempotency_key_uidx
  ON public.payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE public.trips ADD COLUMN IF NOT EXISTS payment_status text;

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS credit_balance_cents integer NOT NULL DEFAULT 0;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS stripe_account_id text;

CREATE TABLE IF NOT EXISTS public.credit_accounts (
  user_id uuid PRIMARY KEY REFERENCES public.profiles (id) ON DELETE CASCADE,
  balance_cents integer NOT NULL DEFAULT 0 CHECK (balance_cents >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  delta_cents integer NOT NULL,
  balance_after integer,
  trip_id uuid,
  kind text NOT NULL,
  idempotency_key text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.driver_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id uuid UNIQUE,
  driver_id uuid,
  amount_cents integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  next_retry_at timestamptz,
  stripe_transfer_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.apply_credit_delta(
  p_user_id uuid,
  p_delta_cents integer,
  p_kind text,
  p_trip_id uuid,
  p_idempotency_key text
) RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  existing_balance integer;
  next_balance integer;
BEGIN
  IF p_idempotency_key IS NOT NULL THEN
    SELECT balance_after INTO existing_balance
    FROM public.credit_ledger
    WHERE idempotency_key = p_idempotency_key;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'duplicate', true, 'balance_cents', COALESCE(existing_balance, 0));
    END IF;
  END IF;

  INSERT INTO public.credit_accounts (user_id, balance_cents)
  VALUES (p_user_id, 0)
  ON CONFLICT (user_id) DO NOTHING;

  SELECT balance_cents INTO existing_balance
  FROM public.credit_accounts
  WHERE user_id = p_user_id
  FOR UPDATE;

  next_balance := COALESCE(existing_balance, 0) + COALESCE(p_delta_cents, 0);
  IF next_balance < 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'credits_insufficient', 'balance_cents', COALESCE(existing_balance, 0));
  END IF;

  UPDATE public.credit_accounts
  SET balance_cents = next_balance, updated_at = now()
  WHERE user_id = p_user_id;

  UPDATE public.profiles
  SET credit_balance_cents = next_balance
  WHERE id = p_user_id;

  INSERT INTO public.credit_ledger (user_id, delta_cents, balance_after, trip_id, kind, idempotency_key)
  VALUES (p_user_id, p_delta_cents, next_balance, p_trip_id, COALESCE(p_kind, 'adjust'), p_idempotency_key);

  RETURN jsonb_build_object('ok', true, 'duplicate', false, 'balance_cents', next_balance);
END;
$$;

-- Trip status cannot move to completed or canceled while a payment hold is open
-- unless the hold was cleared or the amount due is zero (metadata.payment_hold removed).
CREATE OR REPLACE FUNCTION public.block_unpaid_trip_close()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IN ('completed', 'canceled')
     AND OLD.status IS DISTINCT FROM NEW.status
     AND NEW.metadata ? 'payment_hold'
     AND COALESCE(NEW.metadata -> 'payment_hold' ->> 'status', '') = 'payment_required'
  THEN
    RAISE EXCEPTION 'payment_required';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trips_block_unpaid_close ON public.trips;
CREATE TRIGGER trips_block_unpaid_close
  BEFORE UPDATE ON public.trips
  FOR EACH ROW EXECUTE FUNCTION public.block_unpaid_trip_close();
