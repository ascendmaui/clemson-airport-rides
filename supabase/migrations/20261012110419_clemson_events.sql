-- Admin-editable Clemson event calendar used by the driver earnings forecast.
-- Additive only: new table, RLS, and seed rows (ON CONFLICT DO NOTHING).
-- Home dates verified 2026-10-12 from clemsontigers.com (2026 schedule release + season page).
-- kickoff_at is NULL where the school still lists the time as TBA. Admins should fill it in when announced.

CREATE TABLE IF NOT EXISTS public.clemson_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('football_home', 'campus_event', 'airport_peak', 'other')),
  title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 140),
  event_date date NOT NULL,
  starts_at timestamptz,
  zone text NOT NULL DEFAULT 'stadium' CHECK (zone IN ('downtown', 'campus', 'stadium', 'gsp', 'clt', 'atl')),
  demand_weight numeric NOT NULL DEFAULT 1.0 CHECK (demand_weight > 0 AND demand_weight <= 5),
  notes text,
  source text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT clemson_events_kind_date_title_key UNIQUE (kind, event_date, title)
);

CREATE INDEX IF NOT EXISTS clemson_events_date_idx ON public.clemson_events (event_date) WHERE active;

DROP TRIGGER IF EXISTS clemson_events_updated_at ON public.clemson_events;
CREATE TRIGGER clemson_events_updated_at
  BEFORE UPDATE ON public.clemson_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clemson_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS clemson_events_read ON public.clemson_events;
CREATE POLICY clemson_events_read ON public.clemson_events
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS clemson_events_admin_write ON public.clemson_events;
CREATE POLICY clemson_events_admin_write ON public.clemson_events
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.clemson_events TO authenticated;
GRANT ALL ON public.clemson_events TO service_role;

COMMENT ON TABLE public.clemson_events IS
  'Admin-editable event calendar for the driver earnings forecast. Edit rows in the Supabase table editor (admins only via RLS). kickoff TBA = starts_at NULL.';

INSERT INTO public.clemson_events (kind, title, event_date, starts_at, zone, demand_weight, notes, source) VALUES
  ('football_home', 'Football vs. Georgia Southern', '2026-09-12', '2026-09-12 19:30-04', 'stadium', 2.5, 'Football Reunion Day', 'clemsontigers.com 2026 schedule'),
  ('football_home', 'Football vs. North Carolina', '2026-09-19', '2026-09-19 12:00-04', 'stadium', 3.0, 'Family Weekend', 'clemsontigers.com 2026 schedule'),
  ('football_home', 'Football vs. Miami (Fla.)', '2026-10-03', '2026-10-03 19:30-04', 'stadium', 3.0, NULL, 'clemsontigers.com 2026 schedule'),
  ('football_home', 'Football vs. Charleston Southern', '2026-10-17', '2026-10-17 12:00-04', 'stadium', 2.0, 'Military Appreciation Day', 'clemsontigers.com 2026 schedule'),
  ('football_home', 'Football vs. Virginia Tech', '2026-10-24', NULL, 'stadium', 3.0, 'Homecoming. Kickoff TBA', 'clemsontigers.com 2026 schedule'),
  ('football_home', 'Football vs. Georgia Tech', '2026-11-14', NULL, 'stadium', 2.5, 'Senior Day. Kickoff TBA', 'clemsontigers.com 2026 schedule'),
  ('football_home', 'Football vs. South Carolina', '2026-11-28', NULL, 'stadium', 3.5, 'Rivalry game. Kickoff TBA', 'clemsontigers.com 2026 schedule')
ON CONFLICT (kind, event_date, title) DO NOTHING;
