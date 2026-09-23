/**
 * Two-way standing. Same thresholds as public.profile_standing (SQL).
 *
 * Thin samples are never flagged.
 * - watch (soft flag): average below 3.0 with at least 3 ratings. Still matchable.
 *   Shown as "Low rating" on profiles, driver cards, and ride offers.
 * - restricted (hide from match + admin flag on profiles.standing):
 *   average below 2.5 with at least 5 ratings.
 *   Drivers drop out of the online list. Riders are not offered to drivers.
 * Both rider→driver and driver→rider ratings feed rating_avg / rating_count,
 * and the ratings trigger writes standing.
 */
export const RATING_STANDING = {
  watchBelow: 3,
  watchMinCount: 3,
  restrictBelow: 2.5,
  restrictMinCount: 5,
}

export function standingFromRatings(avg, count) {
  const c = Number(count) || 0
  const a = Number(avg)
  if (!Number.isFinite(a) || c <= 0) return 'good'
  if (c >= RATING_STANDING.restrictMinCount && a < RATING_STANDING.restrictBelow) return 'restricted'
  if (c >= RATING_STANDING.watchMinCount && a < RATING_STANDING.watchBelow) return 'watch'
  return 'good'
}
