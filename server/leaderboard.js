import { buildLeaderboard } from '../shared/perks/leaderboard.js'
import { nyWeekStartDay } from '../shared/perks/time.js'
import { isDemoDriverId } from '../shared/demoFleet.js'
import { isSimulatedDriverId } from '../packages/rides-native/simulatedDrivers.js'
import { isBusyRosterId } from '../packages/rides-native/busyRoster.js'
import { isE2ETestUser } from '../shared/e2eTestAccounts.js'
import { loadPerkConfig } from './perks.js'

/** UTC instant of Monday 00:00 New York for the current week. */
export function weekStartIso(now = new Date()) {
  const day = nyWeekStartDay(now)
  for (const offset of ['-04:00', '-05:00']) {
    const iso = new Date(`${day}T00:00:00${offset}`)
    const check = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' }).format(iso)
    if (check === '00') return iso.toISOString()
  }
  return new Date(`${day}T05:00:00Z`).toISOString()
}

export async function weeklyLeaderboard(sb, viewerId, { now = new Date() } = {}) {
  const config = await loadPerkConfig(sb, 'leaderboard', {})
  if (config.enabled === false) return { enabled: false }
  const since = weekStartIso(now)
  const trips = await sb.from('trips').select('id, driver_id, status, fare_cents, driver_wait_earnings_cents, metadata')
    .eq('status', 'completed').gte('completed_at', since).limit(5000)
  if (trips.error) throw new Error(trips.error.message)
  const ids = [...new Set((trips.data || []).map((t) => t.driver_id).filter(Boolean))]
  const [profiles, prefs] = ids.length
    ? await Promise.all([
      sb.from('profiles').select('id, full_name, email').in('id', ids),
      sb.from('driver_perk_prefs').select('driver_id, leaderboard_opt_out').in('driver_id', ids),
    ])
    : [{ data: [] }, { data: [] }]
  const optedOut = new Set((prefs.data || []).filter((p) => p.leaderboard_opt_out).map((p) => p.driver_id))
  const e2e = new Set((profiles.data || []).filter((p) => isE2ETestUser(p)).map((p) => p.id))
  const excluded = (id) => optedOut.has(id) || e2e.has(id) || isDemoDriverId(id) || isSimulatedDriverId(id) || isBusyRosterId(id)
  const board = buildLeaderboard(trips.data, (profiles.data || []).map(({ id, full_name }) => ({ id, full_name })), { excluded, size: Number(config.size) || 10, viewerId })
  const mePref = (prefs.data || []).find((p) => p.driver_id === viewerId)
  return { enabled: true, weekStart: since, optedOut: Boolean(mePref?.leaderboard_opt_out), ...board }
}

export async function setLeaderboardOptOut(sb, driverId, optOut) {
  const res = await sb.from('driver_perk_prefs').upsert({ driver_id: driverId, leaderboard_opt_out: Boolean(optOut), updated_at: new Date().toISOString() }, { onConflict: 'driver_id' })
  if (res.error) throw new Error(res.error.message)
  return { ok: true, optedOut: Boolean(optOut) }
}
