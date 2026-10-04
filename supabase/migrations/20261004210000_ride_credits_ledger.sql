-- Server-owned ride credits. A rider with no row starts at zero.
-- This migration does not insert balances and does not grant credits.

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

CREATE INDEX IF NOT EXISTS credit_ledger_user_idx
  ON public.credit_ledger (user_id, created_at);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS credit_balance_cents integer NOT NULL DEFAULT 0;

ALTER TABLE public.credit_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credit_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_accounts_select_own ON public.credit_accounts;
CREATE POLICY credit_accounts_select_own ON public.credit_accounts
  FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS credit_ledger_select_own ON public.credit_ledger;
CREATE POLICY credit_ledger_select_own ON public.credit_ledger
  FOR SELECT USING (user_id = auth.uid());

COMMENT ON TABLE public.credit_accounts IS
  'Server-owned ride credit balance. No row means zero. Riders cannot insert grants.';
COMMENT ON TABLE public.credit_ledger IS
  'Ride credit movements. Selecting credits on a trip does not write a debit.';
