/**
 * One source of truth for which ride options a rider may see and book.
 * Now: an approved driver who is online and not on a trip.
 * Scheduled: no published shift plan exists. Options are tiers at least one
 * approved driver can serve, skipping drivers already booked near that pickup.
 */
import { ACTIONABLE_LEAD_MS } from '../src/lib/scheduledRideModel.js'
import { isSimulatedDriverId } from '../packages/rides-native/simulatedDrivers.js'
import {
  BUSY_TRIP_STATUSES,
  NO_DRIVERS_AVAILABLE_COPY,
  OFFERED_RIDE_TIERS,
  RIDE_OPTIONS_POLL_MS,
  SCHEDULE_AHEAD_DISCOUNT_PCT,
  SCHEDULE_CONFLICT_MS,
  catalogForTierIds,
  isOfferedRideTier,
  pickupConflicts,
  rideOptionLabel,
  tiersFromDrivers,
  vehicleServesComfort,
} from '../shared/rideOptions.js'

export const SCHEDULED_AVAILABILITY_LIMITATION =
  'Scheduled rides do not use who is online right now. There is no driver shift plan or published future schedule, so a tier is shown when at least one approved driver is qualified for it and is not already booked within 45 minutes of the pickup. That is not a forecast that a driver will be on shift.'

function approvedRow(row) {
  return String(row?.onboarding_status || '').trim().toLowerCase() === 'approved'
}

async function selectVehicles(sb, ids) {
  const full = await sb
    .from('vehicles')
    .select('driver_id, service_class, tier')
    .in('driver_id', ids)
  if (!full.error) return full
  if (/service_class|schema cache|column/i.test(full.error.message || '')) {
    return sb.from('vehicles').select('driver_id, tier').in('driver_id', ids)
  }
  return full
}

function indexByDriver(rows) {
  const map = new Map()
  for (const row of rows || []) {
    if (row?.driver_id && !map.has(row.driver_id)) map.set(row.driver_id, row)
  }
  return map
}

/**
 * @param {object} sb
 * @param {{ scheduledFor?: string | Date | null, now?: Date }} [options]
 */
export async function loadRideAvailability(sb, { scheduledFor = null, now = new Date() } = {}) {
  const clock = now instanceof Date ? now : new Date(now)
  const when = scheduledFor ? new Date(scheduledFor) : null
  const scheduled = Boolean(when && !Number.isNaN(when.getTime()) && when.getTime() > clock.getTime())
  if (!sb) {
    return availabilityPayload({
      mode: scheduled ? 'scheduled' : 'now',
      scheduledFor: scheduled ? when.toISOString() : null,
      tierIds: [],
      error: 'Ride options are unavailable.',
    })
  }

  const apps = await sb.from('driver_applications').select('profile_id, onboarding_status')
  if (apps.error) {
    return availabilityPayload({
      mode: scheduled ? 'scheduled' : 'now',
      scheduledFor: scheduled ? when.toISOString() : null,
      tierIds: [],
      error: apps.error.message || 'Could not read drivers',
    })
  }
  const approvedIds = []
  for (const row of apps.data || []) {
    if (approvedRow(row) && row.profile_id && !isSimulatedDriverId(row.profile_id) && !approvedIds.includes(row.profile_id)) {
      approvedIds.push(row.profile_id)
    }
  }
  if (!approvedIds.length) {
    return availabilityPayload({
      mode: scheduled ? 'scheduled' : 'now',
      scheduledFor: scheduled ? when.toISOString() : null,
      tierIds: [],
    })
  }

  const [vehicles, presence, trips] = await Promise.all([
    selectVehicles(sb, approvedIds),
    sb.from('driver_status').select('driver_id, online').in('driver_id', approvedIds),
    sb.from('trips').select('driver_id, status, pickup_at, scheduled_for').in('driver_id', approvedIds),
  ])
  if (vehicles.error) {
    return availabilityPayload({
      mode: scheduled ? 'scheduled' : 'now',
      scheduledFor: scheduled ? when.toISOString() : null,
      tierIds: [],
      error: vehicles.error.message || 'Could not read vehicles',
    })
  }
  if (presence.error) {
    return availabilityPayload({
      mode: scheduled ? 'scheduled' : 'now',
      scheduledFor: scheduled ? when.toISOString() : null,
      tierIds: [],
      error: presence.error.message || 'Could not read driver status',
    })
  }
  if (trips.error) {
    return availabilityPayload({
      mode: scheduled ? 'scheduled' : 'now',
      scheduledFor: scheduled ? when.toISOString() : null,
      tierIds: [],
      error: trips.error.message || 'Could not read trips',
    })
  }

  const vehicleByDriver = indexByDriver(vehicles.data)
  const online = new Set()
  for (const row of presence.data || []) {
    if (row?.online && row.driver_id) online.add(row.driver_id)
  }
  const busy = new Set()
  const conflict = new Set()
  for (const trip of trips.data || []) {
    if (!trip?.driver_id) continue
    const status = String(trip.status || '')
    if (BUSY_TRIP_STATUSES.includes(status)) busy.add(trip.driver_id)
    if (!scheduled) continue
    const stamp = trip.pickup_at || trip.scheduled_for
    if (!stamp) continue
    if (!['scheduled', 'accepted', 'arriving', 'arrived'].includes(status)) continue
    if (pickupConflicts(stamp, when, Math.max(SCHEDULE_CONFLICT_MS, ACTIONABLE_LEAD_MS))) {
      conflict.add(trip.driver_id)
    }
  }

  const drivers = approvedIds.map((id) => ({
    id,
    approved: true,
    suspended: false,
    online: online.has(id),
    busy: busy.has(id),
    conflict: conflict.has(id),
    comfort: vehicleServesComfort(vehicleByDriver.get(id)),
  }))
  const tierIds = tiersFromDrivers(drivers, scheduled ? 'scheduled' : 'now')
  return availabilityPayload({
    mode: scheduled ? 'scheduled' : 'now',
    scheduledFor: scheduled ? when.toISOString() : null,
    tierIds,
  })
}

export function availabilityPayload({ mode, scheduledFor, tierIds, error = null }) {
  const ids = (tierIds || []).filter((id) => isOfferedRideTier(id))
  const empty = ids.length === 0
  return {
    mode,
    scheduledFor: scheduledFor || null,
    basis: mode === 'scheduled' ? 'qualified_approved' : 'online_available',
    futureAvailabilitySignal: false,
    limitation: mode === 'scheduled' ? SCHEDULED_AVAILABILITY_LIMITATION : null,
    tiers: OFFERED_RIDE_TIERS.map((id) => ({
      id,
      name: rideOptionLabel(id),
      available: ids.includes(id),
    })).filter((row) => row.available),
    availableTierIds: ids,
    catalog: catalogForTierIds(ids),
    empty,
    emptyMessage: empty
      ? (mode === 'scheduled'
        ? 'No approved driver can serve a ride at that time.'
        : NO_DRIVERS_AVAILABLE_COPY)
      : null,
    schedulePath: 'schedule',
    pollSeconds: RIDE_OPTIONS_POLL_MS / 1000,
    scheduleDiscountPct: SCHEDULE_AHEAD_DISCOUNT_PCT,
    error,
  }
}

export async function assertTierAvailable(sb, tier, { scheduledFor = null, now = new Date() } = {}) {
  const snapshot = await loadRideAvailability(sb, { scheduledFor, now })
  if (snapshot.error) {
    const error = new Error('Could not check ride availability.')
    error.status = 503
    error.code = 'ride_options_unavailable'
    throw error
  }
  if (!snapshot.availableTierIds.includes(tier)) {
    const error = new Error(
      snapshot.mode === 'scheduled'
        ? 'That ride option is not available for this pickup time.'
        : 'That ride option is not available right now.',
    )
    error.status = 409
    error.code = 'ride_option_unavailable'
    error.availability = snapshot
    throw error
  }
  return snapshot
}
