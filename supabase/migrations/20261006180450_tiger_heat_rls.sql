-- Lock Tiger Heat solvency tables behind row level security.
--
-- Rider and driver apps do not query these tables. Campus maps call
-- GET /api/tiger-heat. Trip request and trip settle reserve, release, and
-- settle ledger rows. Those server paths use the service-role client
-- (friendRideLib.admin() / SUPABASE_SERVICE_ROLE_KEY). service_role has
-- BYPASSRLS, so the heat map and solvency guard keep working.
--
-- anon has no privileges. An authenticated session can read or write a row
-- only when public.is_admin() is true (the admin override for the floor,
-- and ledger inspection). There is no rider or driver select policy: the
-- ledger has no per-user key, and opening it to every signed-in account
-- would publish platform margin through the client.

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

ALTER TABLE public.tiger_heat_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiger_heat_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tiger_heat_config FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.tiger_heat_ledger FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.tiger_heat_config TO service_role;
GRANT ALL ON TABLE public.tiger_heat_ledger TO service_role;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tiger_heat_config TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tiger_heat_ledger TO authenticated;

DROP POLICY IF EXISTS tiger_heat_config_admin_all ON public.tiger_heat_config;
CREATE POLICY tiger_heat_config_admin_all
  ON public.tiger_heat_config
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS tiger_heat_ledger_admin_all ON public.tiger_heat_ledger;
CREATE POLICY tiger_heat_ledger_admin_all
  ON public.tiger_heat_ledger
  FOR ALL
  TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());
