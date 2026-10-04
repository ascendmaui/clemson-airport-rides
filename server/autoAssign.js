import { receivableDriverIds } from './driverApproval.js'
import { defaultDriverRank, sortByDefaultDriverOrder } from '../shared/driverOrder.js'

function listedTesla(vehicle) {
  if (!vehicle) return false
  if (vehicle.is_tesla === true) return true
  const tier = String(vehicle.tier || '').trim().toLowerCase()
  if (tier === 'tesla' || tier === 'tesla_self_driving') return true
  const make = String(vehicle.make || '').trim().toLowerCase()
  const model = String(vehicle.model || '').trim().toLowerCase()
  return make === 'tesla' && /\bmodel\s*3\b/.test(model)
}

/**
 * Approved drivers who are online, John then Kim then everyone else.
 * Email is used for rank and is not returned.
 */
export async function listAssignableDrivers(sb, { tier = 'standard' } = {}) {
  if (!sb) return { drivers: [], error: 'no_client' }
  const statusRes = await sb.from('driver_status').select('driver_id, online').eq('online', true)
  if (statusRes.error) return { drivers: [], error: statusRes.error.message || 'Could not read online drivers' }
  const ids = []
  for (const row of statusRes.data || []) {
    if (row?.online && row.driver_id && !ids.includes(row.driver_id)) ids.push(row.driver_id)
  }
  if (!ids.length) return { drivers: [], error: null }

  const gate = await receivableDriverIds(sb, ids)
  if (gate.error) return { drivers: [], error: gate.error }
  const allowed = ids.filter((id) => gate.allowed.has(id))
  if (!allowed.length) return { drivers: [], error: null }

  const profiles = await sb.from('profiles').select('id, email').in('id', allowed)
  if (profiles.error) return { drivers: [], error: profiles.error.message || 'Could not read drivers' }

  let vehiclesByDriver = null
  if (tier === 'tesla') {
    const vehicles = await sb.from('vehicles').select('driver_id, is_tesla, tier, make, model').in('driver_id', allowed)
    if (vehicles.error) return { drivers: [], error: vehicles.error.message || 'Could not verify Tesla listing' }
    vehiclesByDriver = {}
    for (const vehicle of vehicles.data || []) {
      if (vehicle?.driver_id && !vehiclesByDriver[vehicle.driver_id]) {
        vehiclesByDriver[vehicle.driver_id] = vehicle
      }
    }
  }

  const drivers = []
  for (const profile of profiles.data || []) {
    if (!profile?.id || !gate.allowed.has(profile.id)) continue
    if (tier === 'tesla' && !listedTesla(vehiclesByDriver?.[profile.id])) continue
    drivers.push({
      id: profile.id,
      dispatchRank: defaultDriverRank(profile.email),
    })
  }
  return { drivers: sortByDefaultDriverOrder(drivers), error: null }
}

export function nextQueuedDriver(queue, afterDriverId, onlineIds) {
  const list = Array.isArray(queue) ? queue.filter((id) => typeof id === 'string' && id) : []
  const online = onlineIds instanceof Set ? onlineIds : new Set(onlineIds || [])
  const start = list.indexOf(afterDriverId)
  const rest = start >= 0 ? list.slice(start + 1) : list
  return rest.find((id) => online.has(id)) || null
}
