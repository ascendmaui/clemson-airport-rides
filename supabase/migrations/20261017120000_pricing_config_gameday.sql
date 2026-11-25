-- Pricing config, game-day schedule, competitor rate cards, margin alerts.
-- Additive only (new tables, one trigger function). Re-runnable.
-- John's 2026-10-17 decisions:
--   * weekend surge 1.0x; game day 1.25x only on Clemson home football days,
--     kickoff-4h .. kickoff+3h, pickup or dropoff within ~2 mi of Memorial Stadium.
--   * always cheaper than UberX / Lyft (scripts/pricing/compare-competitors.mjs).
--   * always profitable: target margin (default 15%), below-target fares logged.
-- The server reads these with a 60 s cache (server/pricingConfig.js); a bad or
-- missing row falls back to the in-code seed, never to a $0 fare.
-- All tables are service-role only (RLS on, no policies, no anon/authenticated grants).

-- Home games -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.clemson_home_games (
  game_date date PRIMARY KEY,
  opponent text NOT NULL,
  kickoff_et time,                 -- null when TBA
  kickoff_tba boolean NOT NULL DEFAULT false,
  window_start_et time,            -- TBA default window (ET); ignored when kickoff is known
  window_end_et time,
  active boolean NOT NULL DEFAULT true,
  source_url text NOT NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clemson_home_games_kickoff_or_tba CHECK (kickoff_tba OR kickoff_et IS NOT NULL)
);

INSERT INTO public.clemson_home_games (game_date, opponent, kickoff_et, kickoff_tba, window_start_et, window_end_et, source_url, notes) VALUES
  ('2026-10-17', 'Charleston Southern', '12:00', false, NULL, NULL,
   'https://clemsontigers.com/sports/football/schedule/season/2026',
   'Noon kickoff (ACC Network). Window 08:00-15:00 ET.'),
  ('2026-10-24', 'Virginia Tech', NULL, true, '15:00', '22:30',
   'https://clemsontigers.com/sports/football/schedule/season/2026',
   'Listed as "7:00 or 7:30 PM" (TBA). Window covers 19:00-4h to 19:30+3h ET.'),
  ('2026-11-14', 'Georgia Tech', NULL, true, '10:00', '23:59',
   'https://clemsontigers.com/sports/football/schedule/season/2026',
   'Kickoff TBA. Default window 10:00-23:59 ET.'),
  ('2026-11-28', 'South Carolina', NULL, true, '10:00', '23:59',
   'https://clemsontigers.com/sports/football/schedule/season/2026',
   'Kickoff TBA. Default window 10:00-23:59 ET.')
ON CONFLICT (game_date) DO NOTHING;

-- Rate cards (per tier) ----------------------------------------------------------
-- standard drives Standard, Wait & Save (x0.82) and Carpool (50% per seat).
-- comfort / wait rows are optional; without one the tier keeps its Standard scale.
CREATE TABLE IF NOT EXISTS public.pricing_rate_cards (
  tier text PRIMARY KEY CHECK (tier IN ('standard', 'comfort', 'wait')),
  base_cents integer NOT NULL CHECK (base_cents BETWEEN 0 AND 2000),
  booking_fee_cents integer NOT NULL CHECK (booking_fee_cents BETWEEN 0 AND 2000),
  per_mile_cents integer NOT NULL CHECK (per_mile_cents BETWEEN 0 AND 1000),
  per_minute_cents integer NOT NULL CHECK (per_minute_cents BETWEEN 0 AND 300),
  min_fare_cents integer NOT NULL CHECK (min_fare_cents BETWEEN 100 AND 5000),
  active boolean NOT NULL DEFAULT true,
  updated_by text,
  change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.pricing_rate_cards (tier, base_cents, booking_fee_cents, per_mile_cents, per_minute_cents, min_fare_cents, updated_by, change_reason)
VALUES ('standard', 119, 265, 114, 18, 590, 'migration 20261017120000', 'seed: FARE_CARD 2026-09-23')
ON CONFLICT (tier) DO NOTHING;

-- Settings (single row) -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pricing_settings (
  id smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  target_margin_pct numeric(5,2) NOT NULL DEFAULT 15 CHECK (target_margin_pct BETWEEN 0 AND 90),
  stripe_fee_pct numeric(5,2) NOT NULL DEFAULT 2.9 CHECK (stripe_fee_pct BETWEEN 0 AND 10),
  stripe_fixed_cents integer NOT NULL DEFAULT 30 CHECK (stripe_fixed_cents BETWEEN 0 AND 500),
  overhead_cents_per_ride integer NOT NULL DEFAULT 75 CHECK (overhead_cents_per_ride BETWEEN 0 AND 2000),
  carpool_overhead_seats integer NOT NULL DEFAULT 1 CHECK (carpool_overhead_seats BETWEEN 1 AND 6),
  floor_per_mile_cents integer NOT NULL DEFAULT 90 CHECK (floor_per_mile_cents >= 0),
  floor_per_minute_cents integer NOT NULL DEFAULT 18 CHECK (floor_per_minute_cents >= 0),
  floor_min_fare_cents integer NOT NULL DEFAULT 500 CHECK (floor_min_fare_cents >= 0),
  competitor_undercut_pct numeric(5,2) NOT NULL DEFAULT 3 CHECK (competitor_undercut_pct BETWEEN 0 AND 50),
  game_day_multiplier numeric(4,2) NOT NULL DEFAULT 1.25 CHECK (game_day_multiplier BETWEEN 1 AND 1.25),
  game_day_radius_miles numeric(4,2) NOT NULL DEFAULT 2 CHECK (game_day_radius_miles BETWEEN 0 AND 10),
  game_day_before_min integer NOT NULL DEFAULT 240 CHECK (game_day_before_min BETWEEN 0 AND 720),
  game_day_after_min integer NOT NULL DEFAULT 180 CHECK (game_day_after_min BETWEEN 0 AND 720),
  weekend_multiplier numeric(4,2) NOT NULL DEFAULT 1 CHECK (weekend_multiplier BETWEEN 1 AND 1.25),
  surge_cap numeric(4,2) NOT NULL DEFAULT 1.25 CHECK (surge_cap BETWEEN 1 AND 1.25),
  overhead_note text NOT NULL DEFAULT 'Assumed $0.75/ride: support, insurance reserve, maps/SMS/push, hosting. Revisit with real monthly costs.',
  updated_by text,
  change_reason text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.pricing_settings (id, updated_by, change_reason)
VALUES (1, 'migration 20261017120000', 'seed defaults')
ON CONFLICT (id) DO NOTHING;

-- Competitor rate cards -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.competitor_rate_cards (
  competitor text NOT NULL,
  tier text NOT NULL,
  our_tier text NOT NULL CHECK (our_tier IN ('standard', 'comfort')),
  base_cents integer NOT NULL CHECK (base_cents >= 0),
  booking_fee_cents integer NOT NULL CHECK (booking_fee_cents >= 0),
  per_mile_cents integer NOT NULL CHECK (per_mile_cents >= 0),
  per_minute_cents integer NOT NULL CHECK (per_minute_cents >= 0),
  min_fare_cents integer NOT NULL CHECK (min_fare_cents >= 0),
  min_includes_booking boolean NOT NULL DEFAULT true,
  market text NOT NULL DEFAULT 'clemson_sc',
  source_url text NOT NULL,
  source_kind text NOT NULL DEFAULT 'third_party',
  fetched_at timestamptz NOT NULL,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (competitor, tier, market)
);

INSERT INTO public.competitor_rate_cards (competitor, tier, our_tier, base_cents, booking_fee_cents, per_mile_cents, per_minute_cents, min_fare_cents, min_includes_booking, source_url, source_kind, fetched_at, notes) VALUES
  ('uber', 'uberx', 'standard', 119, 265, 114, 18, 590, true, 'https://uphail.com/us/sc/clemson/', 'third_party', '2026-10-17T09:30:00Z',
   'Uber publishes no Clemson rate card (uber.com city page shows only average route prices). UpHail Clemson UberX: base $1.19, $1.14/mi, $0.18/min, Safe Ride fee $2.65, minimum $5.90.'),
  ('uber', 'uber_comfort', 'comfort', 178, 345, 131, 24, 1069, true, 'https://uphail.com/us/sc/clemson/', 'third_party', '2026-10-17T09:30:00Z',
   'UpHail Clemson Uber Comfort: base $1.78, $1.31/mi, $0.24/min, Safe Ride fee $3.45, minimum $10.69.'),
  ('lyft', 'lyft_standard', 'standard', 80, 325, 114, 17, 307, false, 'https://www.lyft.com/pricing/GSP', 'official_snapshot', '2026-10-17T09:30:00Z',
   'Lyft GSP-region pricing page (covers Clemson) as indexed 2026-10-17: base $0.80, $1.14/mi, $0.17/min, service fee $3.25, minimum $3.07 (+1% SC assessment). Direct fetch returned 404 that day. UpHail lists base $1.20, no service fee.'),
  ('lyft', 'lyft_extra_comfort', 'comfort', 137, 345, 150, 18, 398, false, 'https://www.lyft.com/pricing/GSP', 'official_snapshot', '2026-10-17T09:30:00Z',
   'Lyft GSP-region Extra Comfort as indexed 2026-10-17: base $1.37, $1.50/mi, $0.18/min, service fee $3.45, minimum $3.98.')
ON CONFLICT (competitor, tier, market) DO NOTHING;

-- Audit (history of every config change) ------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pricing_config_audit (
  id bigserial PRIMARY KEY,
  table_name text NOT NULL,
  row_key text NOT NULL,
  action text NOT NULL CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
  old_row jsonb,
  new_row jsonb,
  changed_by text,
  change_reason text,
  db_user text NOT NULL DEFAULT current_user,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pricing_config_audit_changed_at_idx ON public.pricing_config_audit (changed_at DESC);

CREATE OR REPLACE FUNCTION public.pricing_config_audit_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old jsonb := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) END;
  v_new jsonb := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) END;
  v_row jsonb := coalesce(v_new, v_old);
  v_key text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := now();
    v_new := to_jsonb(NEW);
    IF (v_old - 'updated_at') = (v_new - 'updated_at') THEN
      RETURN NEW;
    END IF;
  END IF;
  v_key := coalesce(v_row->>'tier', v_row->>'game_date', v_row->>'id', '')
    || CASE WHEN v_row ? 'competitor' THEN ':' || (v_row->>'competitor') ELSE '' END;
  INSERT INTO public.pricing_config_audit (table_name, row_key, action, old_row, new_row, changed_by, change_reason)
  VALUES (TG_TABLE_NAME, v_key, TG_OP, v_old, v_new, v_row->>'updated_by', v_row->>'change_reason');
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS pricing_rate_cards_audit ON public.pricing_rate_cards;
CREATE TRIGGER pricing_rate_cards_audit
  BEFORE INSERT OR UPDATE OR DELETE ON public.pricing_rate_cards
  FOR EACH ROW EXECUTE FUNCTION public.pricing_config_audit_row();

DROP TRIGGER IF EXISTS pricing_settings_audit ON public.pricing_settings;
CREATE TRIGGER pricing_settings_audit
  BEFORE INSERT OR UPDATE OR DELETE ON public.pricing_settings
  FOR EACH ROW EXECUTE FUNCTION public.pricing_config_audit_row();

DROP TRIGGER IF EXISTS clemson_home_games_audit ON public.clemson_home_games;
CREATE TRIGGER clemson_home_games_audit
  BEFORE INSERT OR UPDATE OR DELETE ON public.clemson_home_games
  FOR EACH ROW EXECUTE FUNCTION public.pricing_config_audit_row();

DROP TRIGGER IF EXISTS competitor_rate_cards_audit ON public.competitor_rate_cards;
CREATE TRIGGER competitor_rate_cards_audit
  BEFORE INSERT OR UPDATE OR DELETE ON public.competitor_rate_cards
  FOR EACH ROW EXECUTE FUNCTION public.pricing_config_audit_row();

-- Below-margin alerts ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pricing_margin_alerts (
  id bigserial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL CHECK (source IN ('quote', 'booking', 'compare')),
  trip_id uuid,
  tier text,
  fare_cents integer,
  driver_payout_cents integer,
  stripe_fee_cents integer,
  overhead_cents integer,
  profit_cents integer,
  margin_bps integer,
  target_bps integer,
  surge_multiplier numeric(4,2),
  seat_count integer,
  details jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS pricing_margin_alerts_created_at_idx ON public.pricing_margin_alerts (created_at DESC);
CREATE INDEX IF NOT EXISTS pricing_margin_alerts_trip_idx ON public.pricing_margin_alerts (trip_id) WHERE trip_id IS NOT NULL;

-- Access: service role only ------------------------------------------------------------
ALTER TABLE public.clemson_home_games ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.competitor_rate_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_config_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pricing_margin_alerts ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON public.clemson_home_games, public.pricing_rate_cards, public.pricing_settings, public.competitor_rate_cards, public.pricing_config_audit, public.pricing_margin_alerts FROM %I', r);
      EXECUTE format('REVOKE ALL ON SEQUENCE public.pricing_config_audit_id_seq, public.pricing_margin_alerts_id_seq FROM %I', r);
      EXECUTE format('REVOKE EXECUTE ON FUNCTION public.pricing_config_audit_row() FROM %I', r);
    END IF;
  END LOOP;
END
$$;
REVOKE EXECUTE ON FUNCTION public.pricing_config_audit_row() FROM PUBLIC;
