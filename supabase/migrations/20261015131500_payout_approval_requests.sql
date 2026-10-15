-- Admin approval gate for live driver money (cash-out, trip payouts, tips,
-- backup fees, perks/bonuses). Additive only.
-- Every live Stripe transfer/payout to a driver first creates one row here in
-- pending_approval. Only the sole payout approver (johnmatveyev@gmail.com,
-- checked server-side and in RLS) can approve or reject. The server executes
-- the Stripe call only after approval, with an idempotency key derived from
-- the row id, so one request can never pay twice.

CREATE TABLE IF NOT EXISTS public.payout_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_ref text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN (
    'cashout', 'trip_payout', 'wait_cancel', 'tip', 'standby', 'cancel_fee', 'switch_fee', 'bonus', 'affiliate'
  )),
  payee_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  currency text NOT NULL DEFAULT 'usd',
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN (
    'pending_approval', 'approved', 'sent', 'rejected', 'failed', 'superseded'
  )),
  source_id text,
  trip_id uuid,
  destination_account text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  stripe_transfer_id text,
  stripe_payout_id text,
  last_error text,
  reject_reason text CHECK (reject_reason IS NULL OR char_length(reject_reason) <= 500),
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_by uuid,
  decided_by_email text,
  decided_at timestamptz,
  sent_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payout_approval_requests_status_idx
  ON public.payout_approval_requests (status, requested_at DESC);
CREATE INDEX IF NOT EXISTS payout_approval_requests_payee_idx
  ON public.payout_approval_requests (payee_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS public.payout_approval_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.payout_approval_requests(id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('requested', 'approved', 'rejected', 'sent', 'failed', 'superseded')),
  actor_id uuid,
  actor_email text,
  amount_cents integer,
  note text CHECK (note IS NULL OR char_length(note) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payout_approval_events_request_idx
  ON public.payout_approval_events (request_id, created_at);

-- Sole payout approver. Hard-coded on purpose: an env list or profile flag
-- cannot widen who may release live money.
CREATE OR REPLACE FUNCTION public.is_payout_approver()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT EXISTS (
    SELECT 1 FROM auth.users u
    WHERE u.id = auth.uid()
      AND lower(u.email) = 'johnmatveyev@gmail.com'
      AND u.email_confirmed_at IS NOT NULL
  );
$$;

REVOKE ALL ON FUNCTION public.is_payout_approver() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_payout_approver() TO authenticated, service_role;

ALTER TABLE public.payout_approval_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payout_approval_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payout_approval_requests_select_own ON public.payout_approval_requests;
CREATE POLICY payout_approval_requests_select_own
  ON public.payout_approval_requests FOR SELECT TO authenticated
  USING (payee_id = auth.uid() OR public.is_payout_approver());

DROP POLICY IF EXISTS payout_approval_requests_update_approver ON public.payout_approval_requests;
CREATE POLICY payout_approval_requests_update_approver
  ON public.payout_approval_requests FOR UPDATE TO authenticated
  USING (public.is_payout_approver())
  WITH CHECK (public.is_payout_approver());

DROP POLICY IF EXISTS payout_approval_events_select ON public.payout_approval_events;
CREATE POLICY payout_approval_events_select
  ON public.payout_approval_events FOR SELECT TO authenticated
  USING (
    public.is_payout_approver()
    OR EXISTS (
      SELECT 1 FROM public.payout_approval_requests r
      WHERE r.id = request_id AND r.payee_id = auth.uid()
    )
  );

-- Drivers read only. No insert/delete for authenticated users; the server
-- (service role) creates requests and executes approved ones.
REVOKE ALL ON public.payout_approval_requests FROM anon, authenticated;
REVOKE ALL ON public.payout_approval_events FROM anon, authenticated;
GRANT SELECT ON public.payout_approval_requests TO authenticated;
GRANT UPDATE (status, decided_by, decided_by_email, decided_at, reject_reason, updated_at)
  ON public.payout_approval_requests TO authenticated;
GRANT SELECT ON public.payout_approval_events TO authenticated;
GRANT ALL ON public.payout_approval_requests TO service_role;
GRANT ALL ON public.payout_approval_events TO service_role;

-- A signed-in approver may only move pending_approval -> approved/rejected.
-- Execution (sent/failed) and every other change stay server-side.
CREATE OR REPLACE FUNCTION public.guard_payout_approval_update()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user IN ('service_role', 'postgres', 'supabase_admin') THEN
    RETURN NEW;
  END IF;
  IF NOT public.is_payout_approver() THEN
    RAISE EXCEPTION 'payout_approver_only' USING ERRCODE = '42501';
  END IF;
  IF OLD.status <> 'pending_approval' OR NEW.status NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'payout_request_not_pending' USING ERRCODE = 'P0001';
  END IF;
  NEW.decided_by := auth.uid();
  NEW.decided_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payout_approval_requests_guard ON public.payout_approval_requests;
CREATE TRIGGER payout_approval_requests_guard
  BEFORE UPDATE ON public.payout_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.guard_payout_approval_update();
