import { receivableDriverIds } from './driverApproval.js'
import { filterAssignableDrivers, loadComfortProfiles } from './comfortMatch.js'
import { defaultDriverRank, sortByDefaultDriverOrder } from '../shared/driverOrder.js'
import { vehicleServesComfort } from '../shared/rideOptions.js'
import { isSimulatedDriverId } from '../packages/rides-native/simulatedDrivers.js'
import { orderDriversForRider } from '../shared/riderFavorites.js'

/**
 * Approved drivers who are online, John then Kim then everyone else.
 * Email is used for rank and is not returned.
 * Extra Comfort keeps drivers whose vehicle class qualifies.
 * Carpool uses the same approved drivers as Standard.
 * TODO: same-direction pooling of two carpool requests is not built;
 * each carpool booking is offered to one standard-eligible vehicle.
 */
export async function listAssignableDrivers(sb, {
  tier = 'standard',
  riderId = null,
  preferredIds = [],
  favoriteIds = [],
} = {}) {
  if (!sb) return { drivers: [], error: 'no_client' }
  const statusRes = await sb.from('driver_status').select('driver_id, online').eq('online', true)
  if (statusRes.error) return { drivers: [], error: statusRes.error.message || 'Could not read online drivers' }
  const ids = []
  for (const row of statusRes.data || []) {
    if (row?.online && row.driver_id && !isSimulatedDriverId(row.driver_id) && !ids.includes(row.driver_id)) ids.push(row.driver_id)
  }
  if (!ids.length) return { drivers: [], error: null }

  const gate = await receivableDriverIds(sb, ids)
  if (gate.error) return { drivers: [], error: gate.error }
  const allowed = ids.filter((id) => gate.allowed.has(id))
  if (!allowed.length) return { drivers: [], error: null }

  const profiles = await loadComfortProfiles(sb, allowed)
  if (profiles.error) return { drivers: [], error: profiles.error }

  let riderRow = null
  if (riderId && !profiles.unavailable) {
    const riderRes = await sb
      .from('profiles')
      .select('id, gender_identity, women_only_matching')
      .eq('id', riderId)
      .maybeSingle()
    if (riderRes.error && !/column|schema cache|gender_identity|women_only/i.test(riderRes.error.message || '')) {
      return { drivers: [], error: riderRes.error.message || 'Could not read the rider' }
    }
    if (!riderRes.error) riderRow = riderRes.data
  }

  let comfortIds = null
  if (tier === 'comfort') {
    const vehicles = await sb.from('vehicles').select('driver_id, service_class, tier').in('driver_id', allowed)
    if (vehicles.error && /service_class|schema cache|column/i.test(vehicles.error.message || '')) {
      const fallback = await sb.from('vehicles').select('driver_id, tier').in('driver_id', allowed)
      if (fallback.error) return { drivers: [], error: fallback.error.message || 'Could not read vehicles' }
      comfortIds = new Set((fallback.data || []).filter((row) => vehicleServesComfort(row)).map((row) => row.driver_id))
    } else if (vehicles.error) {
      return { drivers: [], error: vehicles.error.message || 'Could not read vehicles' }
    } else {
      comfortIds = new Set((vehicles.data || []).filter((row) => vehicleServesComfort(row)).map((row) => row.driver_id))
    }
  }

  const ranked = []
  for (const profile of profiles.rows || []) {
    if (!profile?.id || !gate.allowed.has(profile.id)) continue
    if (comfortIds && !comfortIds.has(profile.id)) continue
    ranked.push({
      id: profile.id,
      email: profile.email,
      gender_identity: profile.gender_identity,
      women_only_matching: profile.women_only_matching,
      dispatchRank: defaultDriverRank(profile.email),
    })
  }
  const filtered = filterAssignableDrivers(ranked, riderRow, { comfortKnown: !profiles.unavailable })
  const ordered = orderDriversForRider(sortByDefaultDriverOrder(filtered.drivers), {
    preferredIds,
    favoriteIds,
  })
  return {
    drivers: ordered.map((driver) => ({
      id: driver.id,
      dispatchRank: driver.dispatchRank,
    })),
    error: null,
    womenOnlyBlocked: filtered.womenOnlyBlocked,
    riderWantsWomenDrivers: filtered.riderWantsWomenDrivers,
  }
}

export function nextQueuedDriver(queue, afterDriverId, onlineIds) {
  const list = Array.isArray(queue) ? queue.filter((id) => typeof id === 'string' && id) : []
  const online = onlineIds instanceof Set ? onlineIds : new Set(onlineIds || [])
  const start = list.indexOf(afterDriverId)
  const rest = start >= 0 ? list.slice(start + 1) : list
  return rest.find((id) => online.has(id)) || null
}
