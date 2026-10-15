/**
 * Clemson home football schedule (Memorial Stadium) used by peak pricing to
 * detect game days. Edit this file when kickoff times are announced. Rows in
 * public.game_day_events still count as game days on top of this list.
 *
 * Source: clemsontigers.com 2026 schedule and clemsoncity.org special events
 * (checked 2026-10-15). kickoffEt is the America/New_York wall clock, "HH:MM",
 * or null while TBA. A TBA game uses the all-day window in peakPricing.js.
 */
export const CLEMSON_HOME_FOOTBALL_SOURCE = 'https://clemsontigers.com/sports/football/schedule/season/2026'

export const CLEMSON_HOME_FOOTBALL = Object.freeze([
  { date: '2026-09-12', opponent: 'Georgia Southern', kickoffEt: '19:30' },
  { date: '2026-09-19', opponent: 'North Carolina', kickoffEt: '12:00' },
  { date: '2026-10-03', opponent: 'Miami (Fla.)', kickoffEt: null },
  { date: '2026-10-17', opponent: 'Charleston Southern', kickoffEt: '12:00' },
  // Homecoming. Listed as 7:00 or 7:30 PM ET (TBA); 19:00 keeps the earlier window.
  { date: '2026-10-24', opponent: 'Virginia Tech', kickoffEt: '19:00', tentative: true },
  { date: '2026-11-14', opponent: 'Georgia Tech', kickoffEt: null },
  { date: '2026-11-28', opponent: 'South Carolina', kickoffEt: null },
].map((row) => Object.freeze(row)))
