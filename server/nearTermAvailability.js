/**
 * Available-driver wait for near-term slots.
 * Approved, online, not on a trip, not a demo map driver.
 */
import { eligibleDriverIdsForRider } from './e2eDriverEligibility.js'
import { isSimulatedDriverId } from '../packages/rides-native/simulatedDrivers.js'
import {
  BUSY_TRIP_STATUSES,
  SCHEDULE_CONFLICT_MS,
  pickupConflicts,
  resolveOfferedTier,
  vehicleServesComfort,
} from '../shared/rideOptions.js'
import {
  currentWaitFromDrivers,
  offerNearTermSlots,
  waitLabel,
} from '../shared/nearTermSlots.js'

function approvedRow(row) {
  return String(row?.onboarding_status || '').trim().toLowerCase() === 'approved'
}

async function rowsOf(query) {
  const result = await query
  if (result?.error) {
    const error = new Error(result.error.message || 'Could not read drivers')
    error.status = 503
    error.code = 'ride_options_unavailable'
    throw error
  }
  return result?.data || []
}

function indexByDriver(rows) {
  const map = new Map()
  for (const row of rows || []) {
    if (row?.driver_id && !map.has(row.driver_id)) map.set(row.driver_id, row)
  }
  return map
}

function driverBusy(trips, driverId, now) {
  for (const trip of trips || []) {
    if (trip?.driver_id !== driverId) continue
    const status = String(trip.status || '')
    if (BUSY_TRIP_STATUSES.includes(status)) return true
    if (status === 'scheduled' || status === 'accepted') {
      const stamp = trip.pickup_at || trip.scheduled_for
      if (stamp && pickupConflicts(stamp, now, SCHEDULE_CONFLICT_MS)) return true
    }
  }
  return false
}

export async function loadNearTermOffer(sb, {
  pickup,
  tier = 'standard',
  now = new Date(),
  excludeDriverId = null,
  riderIsE2E = false,
} = {}) {
  const resolvedTier = resolveOfferedTier(tier)
  const clock = now instanceof Date ? now : new Date(now)
  const empty = (reason) => ({
    tier: resolvedTier,
    ...offerNearTermSlots({ waitMinutes: null, now: clock, reason }),
    waitLabel: null,
    availableDrivers: 0,
    basis: 'online_available',
    demoDriversExcluded: true,
  })
  if (!pickup || !Number.isFinite(Number(pickup.lat)) || !Number.isFinite(Number(pickup.lng))) {
    return empty('pickup_missing')
  }
  if (!sb) return empty('no_drivers')

  const applications = await rowsOf(sb.from('driver_applications').select('profile_id, onboarding_status'))
  let approvedIds = []
  for (const row of applications) {
    const id = row?.profile_id
    if (!approvedRow(row) || !id || isSimulatedDriverId(id) || id === excludeDriverId) continue
    if (!approvedIds.includes(id)) approvedIds.push(id)
  }
  approvedIds = await eligibleDriverIdsForRider(sb, approvedIds, riderIsE2E)
  if (!approvedIds.length) return empty('no_drivers')

  const [presence, trips, vehicles] = await Promise.all([
    rowsOf(sb.from('driver_status').select('driver_id, online, lat, lng, updated_at, location_updated_at').in('driver_id', approvedIds)),
    rowsOf(sb.from('trips').select('driver_id, status, pickup_at, scheduled_for').in('driver_id', approvedIds)),
    resolvedTier === 'comfort'
      ? rowsOf(sb.from('vehicles').select('driver_id, service_class, tier').in('driver_id', approvedIds))
      : Promise.resolve([]),
  ])
  const presenceByDriver = indexByDriver(presence)
  const vehicleByDriver = indexByDriver(vehicles)
  const drivers = []
  for (const id of approvedIds) {
    const status = presenceByDriver.get(id)
    if (!status?.online) continue
    if (driverBusy(trips, id, clock)) continue
    if (resolvedTier === 'comfort' && !vehicleServesComfort(vehicleByDriver.get(id))) continue
    drivers.push({
      id,
      available: true,
      simulated: false,
      lat: status.lat,
      lng: status.lng,
      updated_at: status.location_updated_at || status.updated_at,
    })
  }
  const wait = currentWaitFromDrivers(drivers, pickup, clock)
  const offered = offerNearTermSlots({
    waitMinutes: wait.waitMinutes,
    now: clock,
    reason: wait.reason,
  })
  return {
    tier: resolvedTier,
    ...offered,
    waitLabel: waitLabel(offered.waitMinutes),
    availableDrivers: wait.availableDrivers,
    nearest: wait.nearest,
    basis: 'online_available',
    demoDriversExcluded: true,
  }
}
