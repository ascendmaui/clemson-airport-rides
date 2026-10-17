/**
 * Seed / fallback for Clemson home football games (Memorial Stadium) used by
 * game-day pricing (shared/gameDaySurge.js). The live copy is the
 * public.clemson_home_games table; this list is used only until that table
 * loads (or if it cannot be read).
 *
 * Remaining 2026 home games ONLY, from the official schedule:
 *   https://clemsontigers.com/sports/football/schedule/season/2026
 *   (checked 2026-10-17; Oct 17 kickoff also in the game notes PDF
 *   https://data.clemsontigers.com/pdf/football/2026-27/Notes/2026-06-CSU.pdf)
 * kickoffEt is the America/New_York wall clock "HH:MM", or null while TBA.
 * A TBA game uses windowStartEt..windowEndEt (default 10:00-23:59 ET).
 */
export const CLEMSON_HOME_FOOTBALL_SOURCE = 'https://clemsontigers.com/sports/football/schedule/season/2026'

export const CLEMSON_HOME_FOOTBALL = Object.freeze([
  { date: '2026-10-17', opponent: 'Charleston Southern', kickoffEt: '12:00', tba: false },
  // Listed as "7:00 OR 7:30 PM ET (TBA)". Window spans both: 19:00-4h .. 19:30+3h.
  { date: '2026-10-24', opponent: 'Virginia Tech', kickoffEt: null, tba: true, windowStartEt: '15:00', windowEndEt: '22:30' },
  { date: '2026-11-14', opponent: 'Georgia Tech', kickoffEt: null, tba: true, windowStartEt: '10:00', windowEndEt: '23:59' },
  { date: '2026-11-28', opponent: 'South Carolina', kickoffEt: null, tba: true, windowStartEt: '10:00', windowEndEt: '23:59' },
].map((row) => Object.freeze(row)))
