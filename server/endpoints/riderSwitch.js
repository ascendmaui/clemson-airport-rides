/**
 * POST /api/rider-switch
 * Before pickup, the rider can drop the matched driver and ask again.
 * confirm omitted returns the fee, the hold plan, online drivers, and prices.
 */
import { loadGameDayMultiplier } from '../creditLots.js'
import { priceDriverRequest, resolveDriverRequestPlaces } from '../authoritativeFare.js'
import { listAssignableDrivers } from '../autoAssign.js'
import { notifyDriverOffer } from '../driverOfferAlerts.js'
import { stripeClient, stripeOk } from '../friendRideLib.js'
import { sendExpoPush } from '../expoPush.js'
import { loadRiderMatchPreferences } from '../riderPass.js'
import { insertTripEvent } from '../tripEvents.js'
import { settleSwitchHold } from '../riderSwitchHold.js'
import { studentDiscountGranted } from '../../src/lib/studentDomain.js'
import { commitRiderSwitch, isRiderSwitchAction, quoteRiderSwitch } from '../../shared/riderSwitch.js'
import { OFFERED_RIDE_TIERS, rideOptionLabel } from '../../shared/rideOptions.js'
import { openPoolLine } from '../../shared/copy/riderSwitch.js'

async function notifyReleasedDriver(sb, driverId, tripId) {
  if (!driverId) return
  try {
    const status = await sb.from('driver_status').select('expo_push_token').eq('driver_id', driverId).maybeSingle()
    const token = status?.data?.expo_push_token
    if (!token) return
    await sendExpoPush({
      to: token,
      title: 'Scheduled ride changed',
      body: 'The rider changed this pickup. You are released from the backup seat.',
      data: { tripId, kind: 'backup_released' },
      channelId: 'ride-requests',
    })
  } catch (error) {
    console.error('[rider-switch] backup release', error?.message || error)
  }
}

function num(value) {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function loadTrip(sb, tripId) {
  const row = await sb.from('trips').select('*').eq('id', tripId).maybeSingle()
  if (row.error) {
    const error = new Error(row.error.message || 'Could not load this ride')
    error.status = 500
    throw error
  }
  return row.data || null
}

async function cardProfile(sb, riderId) {
  const row = await sb
    .from('profiles')
    .select('id, stripe_customer_id, stripe_default_pm_id')
    .eq('id', riderId)
    .maybeSingle()
  if (row.error) return null
  return row.data || null
}

function vehicleLine(vehicle) {
  if (!vehicle) return ''
  return [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ')
}

async function enrichDrivers(sb, ids) {
  if (!ids.length) return []
  const [profiles, vehicles] = await Promise.all([
    sb.from('profiles').select('id, full_name').in('id', ids),
    sb.from('vehicles').select('driver_id, color, make, model').in('driver_id', ids),
  ])
  const names = new Map((profiles.data || []).map((row) => [row.id, row.full_name]))
  const cars = new Map((vehicles.data || []).map((row) => [row.driver_id, row]))
  return ids.map((id) => {
    const name = String(names.get(id) || '').trim()
    return {
      id,
      name: name ? name.split(' ')[0] : 'Driver',
      detail: vehicleLine(cars.get(id)),
    }
  })
}

async function driversForTier(sb, { tier, riderId, excludeId, prefs }) {
  const listed = await listAssignableDrivers(sb, {
    tier,
    riderId,
    preferredIds: prefs?.preferredIds || [],
    favoriteIds: prefs?.favoriteIds || [],
  })
  if (listed.error) {
    const error = new Error('Could not load drivers')
    error.status = 500
    throw error
  }
  const ids = []
  for (const driver of listed.drivers || []) {
    if (!driver?.id || driver.id === excludeId || ids.includes(driver.id)) continue
    ids.push(driver.id)
  }
  const drivers = await enrichDrivers(sb, ids)
  return { drivers, womenOnlyBlocked: Boolean(listed.womenOnlyBlocked) }
}

async function priceForTier(sb, user, trip, tier, prefs, gameDayMultiplier) {
  const places = resolveDriverRequestPlaces({
    pickupLabel: trip.pickup_label,
    pickupLat: num(trip.pickup_lat),
    pickupLng: num(trip.pickup_lng),
    dropoffLabel: trip.dropoff_label,
    dropoffLat: num(trip.dropoff_lat),
    dropoffLng: num(trip.dropoff_lng),
  })
  if (places.error) return { error: places.error, fareCents: null }
  const priced = priceDriverRequest(places, {
    isStudent: studentDiscountGranted(user),
    tier,
    gameDayMultiplier,
    distanceM: num(trip.metadata?.route_distance_m),
    durationS: num(trip.metadata?.route_duration_s),
    tigerPassBps: prefs?.discountBps || 0,
  })
  if (priced?.fareCents == null || !Number.isFinite(Number(priced.fareCents))) {
    return { error: 'Fare is not set', fareCents: null }
  }
  return { fareCents: priced.fareCents, error: null }
}

export async function handleRiderSwitch(sb, user, body, deps = {}) {
  const tripId = String(body?.tripId || body?.trip_id || '').trim()
  if (!tripId) return { status: 400, body: { error: 'Missing ride', code: 'trip_required' } }
  const trip = await loadTrip(sb, tripId)
  if (!trip) return { status: 404, body: { error: 'This ride was not found.', code: 'trip_missing' } }
  if (trip.rider_id !== user.id) {
    return { status: 403, body: { error: 'This ride is on another account.', code: 'not_rider' } }
  }

  const confirm = body?.confirm === true
  const action = confirm ? String(body?.action || '') : 'preview'
  if (confirm && !isRiderSwitchAction(action)) {
    return { status: 400, body: { error: 'Choose what to do with this ride.', code: 'rider_switch_action' } }
  }

  const prefs = deps.prefs || await loadRiderMatchPreferences(sb, user.id)
  let gameDayMultiplier = deps.gameDayMultiplier
  if (gameDayMultiplier === undefined) {
    try {
      const game = await loadGameDayMultiplier(sb, deps.now ? new Date(deps.now) : new Date())
      gameDayMultiplier = game.multiplier
    } catch {
      gameDayMultiplier = null
    }
  }

  const listFor = deps.listDrivers || ((tier) => driversForTier(sb, {
    tier,
    riderId: user.id,
    excludeId: trip.driver_id,
    prefs,
  }))
  const priceTier = deps.priceTier || ((tier) => priceForTier(sb, user, trip, tier, prefs, gameDayMultiplier))

  const currentTier = OFFERED_RIDE_TIERS.includes(trip.tier) ? trip.tier : 'standard'
  const pricedCurrent = await priceTier(currentTier)
  const currentDrivers = await listFor(action === 'switch-tier' ? (body?.tier || currentTier) : currentTier)

  const tiers = []
  for (const id of OFFERED_RIDE_TIERS) {
    const priced = id === currentTier ? pricedCurrent : await priceTier(id)
    const availability = id === currentTier ? currentDrivers : await listFor(id)
    tiers.push({
      id,
      name: rideOptionLabel(id),
      fareCents: priced?.fareCents ?? null,
      available: !priced?.error && (availability.drivers || []).length > 0 && id !== currentTier,
      current: id === currentTier,
    })
  }

  let nextFare = pricedCurrent?.fareCents ?? trip.fare_cents
  let drivers = currentDrivers.drivers || []
  if (confirm && action === 'switch-tier') {
    const picked = tiers.find((row) => row.id === body?.tier)
    if (!picked || picked.fareCents == null) {
      return { status: 409, body: { error: 'That ride option is not priced right now.', code: 'fare_not_set' } }
    }
    if (!picked.available) {
      return { status: 409, body: { error: 'No driver is available for that ride type.', code: 'ride_option_unavailable' } }
    }
    nextFare = picked.fareCents
    const tierDrivers = await listFor(picked.id)
    drivers = tierDrivers.drivers || []
  }

  const quote = quoteRiderSwitch(trip, {
    action: confirm ? action : 'preview',
    nextFareCents: nextFare,
  })

  if (!confirm) {
    return {
      status: 200,
      body: {
        quote,
        drivers,
        tiers,
        poolLine: drivers.length ? null : openPoolLine(),
        error: quote.allowed ? null : quote.message,
        code: quote.allowed ? null : quote.code,
      },
    }
  }

  const committed = commitRiderSwitch({
    trip,
    action,
    driverId: body?.driverId || body?.driver_id || null,
    tier: body?.tier || null,
    drivers,
    nextFareCents: nextFare,
    now: deps.now || new Date().toISOString(),
  })
  if (!committed.ok) {
    return {
      status: committed.status || 409,
      body: { error: committed.error, code: committed.code, quote: committed.quote, drivers, tiers },
    }
  }

  const profile = await cardProfile(sb, user.id)
  const stripe = deps.stripe !== undefined ? deps.stripe : (stripeOk() ? stripeClient() : null)
  const settled = await settleSwitchHold({
    stripe,
    sb,
    trip,
    quote: committed.quote,
    riderId: user.id,
    customerId: profile?.stripe_customer_id || null,
    paymentMethodId: profile?.stripe_default_pm_id || null,
    fareCents: committed.update.fare_cents ?? trip.fare_cents,
  })
  if (!settled.ok) {
    return { status: 502, body: { error: settled.error, code: settled.code, quote: committed.quote } }
  }

  const metadata = {
    ...committed.update.metadata,
    ...(settled.patch || {}),
  }
  const updated = await sb.from('trips').update({
    ...committed.update,
    metadata,
  }).eq('id', trip.id).eq('rider_id', user.id).eq('status', trip.status).select('id, status, driver_id, tier, fare_cents').maybeSingle()
  if (updated.error) {
    return { status: 500, body: { error: updated.error.message || 'Could not update this ride', code: 'rider_switch_failed' } }
  }
  if (!updated.data) {
    return { status: 409, body: { error: 'This ride changed. Refresh and try again.', code: 'rider_switch_conflict' } }
  }

  const event = await insertTripEvent(sb, {
    trip_id: trip.id,
    kind: committed.event.kind,
    payload: committed.event.payload,
  })
  for (const driverId of committed.releasedDriverIds || []) {
    await notifyReleasedDriver(sb, driverId, trip.id)
  }
  if (committed.notifyDriverId) {
    await notifyDriverOffer(sb, {
      trip: {
        id: trip.id,
        pickup_label: trip.pickup_label,
        dropoff_label: trip.dropoff_label,
      },
      driverId: committed.notifyDriverId,
      offerMarker: 'rider_switch',
    }, deps)
  }

  return {
    status: 200,
    body: {
      trip: updated.data,
      quote: committed.quote,
      next: committed.next,
      eventWarning: event.error ? (event.error.message || 'Could not record trip event') : null,
    },
  }
}
