-- Tiger Heat Map ledger and solvency knobs.
-- Table shape only. Row level security is
-- supabase/migrations/20261006180450_tiger_heat_rls.sql.
-- Apply that migration. This file does not enable RLS.
--
-- Rider fare is unchanged. driver_pay_cents is the decoupled driver payout
-- (existing 80% net + flat Tiger Heat bonus + flat duration adjustment).
-- platform_fee_cents is 0 when driver pay exceeds the rider fare.
-- platform_funded_cents is that gap (cost to the platform).
--
-- Margin across reserved + settled rows:
--   revenue = rider_fare_cents - insurance_cents - tax_cents
--   margin  = revenue - driver_pay_cents
-- Released rows are ignored, so a cancel returns the budget.
--
-- tiger_heat_config is the admin override. When a row exists, its values
-- win over env (TIGER_HEAT_MIN_MARGIN_CENTS, TIGER_HEAT_MIN_MARGIN_BPS,
-- TIGER_HEAT_INSURANCE_BPS, TIGER_HEAT_TAX_BPS, TIGER_HEAT_REFERENCE_FARE_CENTS).
-- Defaults when neither is set: $0 floor, 5% of cumulative revenue,
-- insurance 0, tax 0, reference fare $17.98 (zone affordability check).

CREATE TABLE IF NOT EXISTS public.tiger_heat_config (
  id integer PRIMARY KEY DEFAULT 1,
  min_margin_cents integer NOT NULL DEFAULT 0,
  min_margin_bps integer NOT NULL DEFAULT 500,
  insurance_bps integer NOT NULL DEFAULT 0,
  tax_bps integer NOT NULL DEFAULT 0,
  reference_fare_cents integer NOT NULL DEFAULT 1798,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tiger_heat_config_singleton CHECK (id = 1),
  CONSTRAINT tiger_heat_config_nonneg CHECK (
    min_margin_cents >= 0
    AND min_margin_bps >= 0
    AND insurance_bps >= 0
    AND tax_bps >= 0
    AND reference_fare_cents >= 0
  )
);

INSERT INTO public.tiger_heat_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.tiger_heat_ledger (
  reservation_id uuid PRIMARY KEY,
  trip_id uuid,
  zone_id text,
  status text NOT NULL,
  rider_fare_cents integer NOT NULL DEFAULT 0,
  insurance_cents integer NOT NULL DEFAULT 0,
  tax_cents integer NOT NULL DEFAULT 0,
  revenue_cents integer NOT NULL DEFAULT 0,
  driver_base_cents integer NOT NULL DEFAULT 0,
  bonus_cents integer NOT NULL DEFAULT 0,
  driver_pay_cents integer NOT NULL DEFAULT 0,
  platform_fee_cents integer NOT NULL DEFAULT 0,
  platform_funded_cents integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tiger_heat_ledger_status_check CHECK (
    status = ANY (ARRAY['reserved'::text, 'settled'::text, 'released'::text])
  )
);

CREATE INDEX IF NOT EXISTS tiger_heat_ledger_status_idx ON public.tiger_heat_ledger (status);
CREATE INDEX IF NOT EXISTS tiger_heat_ledger_trip_idx ON public.tiger_heat_ledger (trip_id);

COMMENT ON TABLE public.tiger_heat_ledger IS
  'Cumulative Tiger Heat margin. Reserved and settled rows count. Released rows do not. Platform fee is zero when driver pay exceeds rider fare.';

COMMENT ON COLUMN public.tiger_heat_ledger.platform_funded_cents IS
  'Cost to the platform: driver pay minus rider fare, when driver pay is higher. Zero otherwise.';

COMMENT ON TABLE public.tiger_heat_config IS
  'Admin override for the Tiger Heat solvency floor. Wins over env vars.';
