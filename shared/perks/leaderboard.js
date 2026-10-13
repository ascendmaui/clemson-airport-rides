/**
 * Weekly leaderboard (Monday 00:00 America/New_York onward).
 * Names are the driver's first name only. Opted-out, demo, simulated and
 * e2e test drivers never appear.
 */
import { driverTripEarnings } from '../driverTripEarnings.js'
import { riderDriverFirstName } from '../riderDriverPrivacy.js'

export function leaderboardName(fullName) {
  const first = riderDriverFirstName(fullName, '')
  if (!first) return 'Driver'
  return first.charAt(0).toUpperCase() + first.slice(1)
}

/**
 * trips: completed trips this week. profiles: { id, full_name }.
 * excluded(id) -> true for demo/simulated/e2e/opted-out.
 */
export function buildLeaderboard(trips, profiles, { excluded = () => false, size = 10, viewerId = null } = {}) {
  const byDriver = new Map()
  for (const t of trips || []) {
    if (t?.status !== 'completed' || !t.driver_id || t?.metadata?.e2e_test === true) continue
    if (excluded(t.driver_id)) continue
    const row = byDriver.get(t.driver_id) || { driverId: t.driver_id, trips: 0, earningsCents: 0 }
    row.trips += 1
    row.earningsCents += driverTripEarnings(t).netCents
    byDriver.set(t.driver_id, row)
  }
  const names = new Map((profiles || []).map((p) => [p.id, leaderboardName(p.full_name)]))
  const rank = (key) => [...byDriver.values()]
    .sort((a, b) => b[key] - a[key] || (key === 'trips' ? b.earningsCents - a.earningsCents : b.trips - a.trips) || a.driverId.localeCompare(b.driverId))
    .map((r, i) => ({ rank: i + 1, name: names.get(r.driverId) || 'Driver', trips: r.trips, earningsCents: r.earningsCents, you: r.driverId === viewerId }))
  const top = (list) => list.slice(0, size)
  const mine = (list) => list.find((r) => r.you) || null
  const byTrips = rank('trips')
  const byEarnings = rank('earningsCents')
  return { byTrips: top(byTrips), byEarnings: top(byEarnings), you: { trips: mine(byTrips), earnings: mine(byEarnings) } }
}
