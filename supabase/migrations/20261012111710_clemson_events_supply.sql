-- Clemson calendar: driver supply columns on the shared public.clemson_events table.
-- Coordinated with PR #436 (earnings forecast), which created the table; this file
-- repeats its CREATE TABLE IF NOT EXISTS verbatim so main stays consistent in either
-- merge order. Additive only: new columns, a widened kind list, verified seed rows.
-- Rider fares are not touched by anything here.
--
-- driver_bonus_cents / bonus_starts_at / bonus_ends_at: configurable driver bonus window
-- (admin-set; default 0 = off). Payout crediting is NOT wired yet, so leave it at 0
-- until it is.
-- nudge_lead_hours / nudge_sent_at: the trip-sweeps tick pushes one pre-event nudge to
-- approved drivers, nudge_lead_hours before starts_at (or noon ET on event_date).

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
ALTER TABLE public.clemson_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS clemson_events_read ON public.clemson_events;
CREATE POLICY clemson_events_read ON public.clemson_events FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS clemson_events_admin_write ON public.clemson_events;
CREATE POLICY clemson_events_admin_write ON public.clemson_events
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
GRANT SELECT, INSERT, UPDATE, DELETE ON public.clemson_events TO authenticated;
GRANT ALL ON public.clemson_events TO service_role;
DROP TRIGGER IF EXISTS clemson_events_updated_at ON public.clemson_events;
CREATE TRIGGER clemson_events_updated_at BEFORE UPDATE ON public.clemson_events
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.clemson_events
  ADD COLUMN IF NOT EXISTS ends_on date,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS driver_bonus_cents integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bonus_starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS bonus_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS nudge_lead_hours integer NOT NULL DEFAULT 24,
  ADD COLUMN IF NOT EXISTS nudge_sent_at timestamptz;

-- Widen the kind list (drop whichever CHECK constrains kind, then re-add the superset).
DO $$
DECLARE c record;
BEGIN
  FOR c IN SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.clemson_events'::regclass AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%kind%' LOOP
    EXECUTE format('ALTER TABLE public.clemson_events DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE public.clemson_events ADD CONSTRAINT clemson_events_kind_check CHECK (kind IN (
  'football_home', 'campus_event', 'airport_peak', 'other',
  'move_in', 'move_out', 'graduation', 'academic_break', 'big_event'));

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clemson_events_supply_check') THEN
    ALTER TABLE public.clemson_events ADD CONSTRAINT clemson_events_supply_check CHECK (
      driver_bonus_cents BETWEEN 0 AND 2000
      AND nudge_lead_hours BETWEEN 1 AND 168
      AND (ends_on IS NULL OR ends_on >= event_date)
      AND (bonus_starts_at IS NULL OR bonus_ends_at IS NULL OR bonus_ends_at > bonus_starts_at)
      AND (driver_bonus_cents = 0 OR (bonus_starts_at IS NOT NULL AND bonus_ends_at IS NOT NULL)));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS clemson_events_nudge_idx ON public.clemson_events (event_date)
  WHERE active AND nudge_sent_at IS NULL;

-- Seed: only dates verified 2026-10-12 on official Clemson pages (source_url on each row).
INSERT INTO public.clemson_events (kind, title, event_date, ends_on, starts_at, zone, demand_weight, notes, source, source_url, nudge_lead_hours) VALUES
  ('football_home', 'Football vs. Georgia Southern', '2026-09-12', NULL, '2026-09-12 19:30-04', 'stadium', 2.5, 'Football Reunion Day', 'clemsontigers.com 2026 schedule', 'https://clemsontigers.com/sports/football/schedule/season/2026', 24),
  ('football_home', 'Football vs. North Carolina', '2026-09-19', NULL, '2026-09-19 12:00-04', 'stadium', 3.0, 'Family Weekend', 'clemsontigers.com 2026 schedule', 'https://clemsontigers.com/sports/football/schedule/season/2026', 24),
  ('football_home', 'Football vs. Miami (Fla.)', '2026-10-03', NULL, '2026-10-03 19:30-04', 'stadium', 3.0, NULL, 'clemsontigers.com 2026 schedule', 'https://clemsontigers.com/sports/football/schedule/season/2026', 24),
  ('football_home', 'Football vs. Charleston Southern', '2026-10-17', NULL, '2026-10-17 12:00-04', 'stadium', 2.0, 'Military Appreciation Day', 'clemsontigers.com 2026 schedule', 'https://clemsontigers.com/sports/football/schedule/season/2026', 24),
  ('football_home', 'Football vs. Virginia Tech', '2026-10-24', NULL, NULL, 'stadium', 3.0, 'Homecoming. Kickoff TBA', 'clemsontigers.com 2026 schedule', 'https://clemsontigers.com/sports/football/schedule/season/2026', 24),
  ('football_home', 'Football vs. Georgia Tech', '2026-11-14', NULL, NULL, 'stadium', 2.5, 'Senior Day. Kickoff TBA', 'clemsontigers.com 2026 schedule', 'https://clemsontigers.com/sports/football/schedule/season/2026', 24),
  ('football_home', 'Football vs. South Carolina', '2026-11-28', NULL, NULL, 'stadium', 3.5, 'Rivalry game. Kickoff TBA', 'clemsontigers.com 2026 schedule', 'https://clemsontigers.com/sports/football/schedule/season/2026', 24),
  ('academic_break', 'Fall break', '2026-10-12', '2026-10-13', NULL, 'gsp', 1.5, 'University open, classes do not meet', 'Clemson Housing breaks page; Registrar 2026-27 calendar', 'https://www.clemson.edu/housing-dining/residential-resources/move-out.html', 48),
  ('academic_break', 'Thanksgiving break', '2026-11-25', '2026-11-27', NULL, 'gsp', 2.5, 'Classes do not meet; University closed Thu/Fri', 'Clemson Housing breaks page; Clemson events calendar', 'https://www.clemson.edu/housing-dining/residential-resources/move-out.html', 48),
  ('move_out', 'Winter break move-out (housing closes 10 a.m.)', '2026-12-12', NULL, '2026-12-12 10:00-05', 'gsp', 2.5, 'Fall exams Dec 7-11; residence halls close Dec 12 at 10 a.m.', 'Clemson Housing move-out page', 'https://www.clemson.edu/housing-dining/residential-resources/move-out.html', 48),
  ('graduation', 'Doctoral commencement', '2026-12-16', NULL, '2026-12-16 15:00-05', 'campus', 1.5, 'Littlejohn Coliseum', 'Clemson commencement schedule', 'https://www.clemson.edu/commencement/schedule/', 24),
  ('graduation', 'Winter commencement', '2026-12-17', NULL, '2026-12-17 09:00-05', 'campus', 2.5, 'Littlejohn Coliseum; ceremonies 9:00 a.m., 1:30 p.m., 6:00 p.m.', 'Clemson commencement schedule', 'https://www.clemson.edu/commencement/schedule/', 24),
  ('campus_event', 'Spring classes begin (return travel)', '2027-01-06', NULL, NULL, 'gsp', 2.0, 'Spring term Jan 6 - Apr 30', 'Clemson Registrar academic calendars', 'https://www.clemson.edu/registrar/academic-resources/academic-calendars.html', 72),
  ('academic_break', 'Spring break', '2027-03-15', '2027-03-19', NULL, 'gsp', 2.5, 'University open, classes do not meet', 'Clemson Housing breaks page', 'https://www.clemson.edu/housing-dining/residential-resources/move-out.html', 72),
  ('move_out', 'Spring move-out (housing closes 10 a.m.)', '2027-05-01', NULL, '2027-05-01 10:00-04', 'gsp', 2.5, 'Residence halls close May 1 at 10 a.m.', 'Clemson Housing move-out page', 'https://www.clemson.edu/housing-dining/residential-resources/move-out.html', 48)
ON CONFLICT (kind, event_date, title) DO NOTHING;

UPDATE public.clemson_events
SET source_url = 'https://clemsontigers.com/sports/football/schedule/season/2026'
WHERE kind = 'football_home' AND source_url IS NULL AND source ILIKE 'clemsontigers.com%';

-- Past events never nudge.
UPDATE public.clemson_events SET nudge_sent_at = now()
WHERE nudge_sent_at IS NULL AND coalesce(ends_on, event_date) < (now() AT TIME ZONE 'America/New_York')::date;

-- Down:
-- alter table public.clemson_events drop constraint if exists clemson_events_supply_check;
-- alter table public.clemson_events drop column if exists ends_on, drop column if exists source_url,
--   drop column if exists driver_bonus_cents, drop column if exists bonus_starts_at,
--   drop column if exists bonus_ends_at, drop column if exists nudge_lead_hours, drop column if exists nudge_sent_at;
