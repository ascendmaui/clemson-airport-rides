import { canReceiveRides } from '../../shared/driverOnboarding.js'
import { vehicleServesComfort } from '../../shared/rideOptions.js'
import { defaultDriverRank, dispatchRankOf } from '../../shared/driverOrder.js'
import { authedJson } from './apiClient.js'
import { displayFirstName, standingFromRatings } from './authErrors.js'
import { GSP, STADIUM } from './places.js'
import { airportCodeFromLabel } from './riderMoney.js'
import { haversineMeters } from './riderShell.js'
import { isSimulatedDriverId } from './simulatedDrivers.js'
import { favoriteIdsForMatching } from '../../shared/riderFavorites.js'
import { approvalGateMessage } from './syntheticOffers.js'

/** Straight-line campus pace. TODO: a traffic ETA needs a billed GOOGLE_MAPS_API_KEY (Routes). */
const CAMPUS_MPH = 18
const STALE_LOCATION_MS = 10 * 60 * 1000
const STATUS_COLUMNS = 'driver_id, online, priority_mode, lat, lng, heading, unlock_progress, unlock_target, updated_at'
const VEHICLE_COLUMNS = 'id, driver_id, make, model, color, plate, seats, tier'
const PROFILE_COLUMNS = 'id, full_name, phone, email, avatar_url, role, rating_avg, rating_count, standing'
const PROFILE_COLUMNS_NARROW = 'id, full_name, phone, email, avatar_url, role'

export const PREFERRED_MATCH_COPY =
  'This request goes only to the driver you pick. If they decline, the trip is canceled. It does not auto-match to another driver.'

export const PREFERRED_OFFLINE_COPY =
  'Saved drivers who are offline cannot take this request. Pick someone who is online. This screen does not auto-match.'

export const PREFERRED_CANCELED_COPY =
  'That driver declined or the request was canceled. It was not offered to another driver.'

export const OPEN_POOL_COPY =
  'No driver is pinned to this ride. The first available driver can accept it.'

/** Ride options do not filter the driver list by a retired fleet. */
export function filterDriversForFleet(drivers) {
  return Array.isArray(drivers) ? drivers : []
}


const favoriteKey = (userId) => `rider.preferredDrivers.${userId || 'anon'}`

export function preferredTripFields(driverId) {
  return {
    preferred_driver_id: driverId,
    match: 'preferred',
  }
}

export function normalizeFavoriteDriverIds(raw) {
  return favoriteIdsForMatching(raw)
}

export function canFavoriteDriver(driverId) {
  return favoriteIdsForMatching([driverId]).length === 1
}

export function driverApproach(driver, pickup) {
  const empty = { etaMin: null, distanceMi: null }
  const driverLat = driver?.lat ?? driver?.latitude
  const driverLng = driver?.lng ?? driver?.longitude
  const pickupLat = pickup?.lat ?? pickup?.latitude
  const pickupLng = pickup?.lng ?? pickup?.longitude
  if (driverLat == null || driverLng == null || pickupLat == null || pickupLng == null) return empty
  const meters = haversineMeters(
    { lat: Number(driverLat), lng: Number(driverLng) },
    { lat: Number(pickupLat), lng: Number(pickupLng) },
  )
  if (meters == null || !Number.isFinite(meters)) return empty
  const miles = meters / 1609.344
  const etaMin = Math.max(1, Math.round((miles / CAMPUS_MPH) * 60))
  return {
    etaMin,
    distanceMi: Math.round(miles * 10) / 10,
  }
}

export function formatDriverDistance(miles) {
  if (miles == null || !Number.isFinite(Number(miles))) return null
  if (Number(miles) < 0.1) return 'under 0.1 mi'
  return `${Number(miles).toFixed(1)} mi`
}

export function driverAvailabilityLine(driver, now = new Date()) {
  if (!driver?.online) return 'Offline'
  const bits = [driver.priorityMode ? 'Online · Priority' : 'Online']
  if (driver.updatedAt) {
    const age = now.getTime() - new Date(driver.updatedAt).getTime()
    if (Number.isFinite(age) && age > STALE_LOCATION_MS) bits.push('location may be stale')
  }
  return bits.join(' · ')
}

export function describeDriver(driver, pickup, now = new Date()) {
  const approach = driverApproach(driver, pickup)
  const online = Boolean(driver?.online)
  const ratingCount = Number(driver?.ratingCount) || 0
  const ratingAvg = driver?.ratingAvg != null ? Number(driver.ratingAvg) : null
  return {
    ...approach,
    etaLabel: online && approach.etaMin != null ? `${approach.etaMin} min` : null,
    distanceLabel: online ? formatDriverDistance(approach.distanceMi) : null,
    availability: driverAvailabilityLine(driver, now),
    ratingLabel: ratingCount > 0 && ratingAvg != null
      ? `${ratingAvg.toFixed(1)} · ${ratingCount} ratings`
      : 'New driver',
  }
}

export function sortPreferredDrivers(drivers, favoriteIds, pickup) {
  const fav = new Set(normalizeFavoriteDriverIds(favoriteIds))
  return [...(drivers || [])].sort((a, b) => {
    const aFav = fav.has(a.id) ? 0 : 1
    const bFav = fav.has(b.id) ? 0 : 1
    if (aFav !== bFav) return aFav - bFav
    const aOn = a.online ? 0 : 1
    const bOn = b.online ? 0 : 1
    if (aOn !== bOn) return aOn - bOn
    const rank = dispatchRankOf(a) - dispatchRankOf(b)
    if (rank !== 0) return rank
    const aEta = driverApproach(a, pickup).etaMin ?? 999
    const bEta = driverApproach(b, pickup).etaMin ?? 999
    if (aEta !== bEta) return aEta - bEta
    return String(a.name || '').localeCompare(String(b.name || ''))
  })
}

export function groupDriversForPicker(drivers, favoriteIds, passPreferredIds) {
  const fav = new Set(normalizeFavoriteDriverIds(favoriteIds))
  const usePass = Array.isArray(passPreferredIds)
  const pass = new Set(usePass ? normalizeFavoriteDriverIds(passPreferredIds) : [])
  const passPreferred = []
  const preferred = []
  const online = []
  for (const driver of drivers || []) {
    if (usePass && pass.has(driver.id)) passPreferred.push(driver)
    else if (fav.has(driver.id)) preferred.push(driver)
    else if (driver.online) online.push(driver)
  }
  if (!usePass) return { preferred, online }
  return { passPreferred, preferred, online }
}

async function readJson(storage, key) {
  if (!storage?.getItem) return null
  try {
    const raw = await storage.getItem(key)
    if (!raw) return null
    return JSON.parse(raw)
  } catch {
    return null
  }
}

async function writeJson(storage, key, value) {
  if (!storage?.setItem) return
  try {
    await storage.setItem(key, JSON.stringify(value))
  } catch {
    /* phone storage is a mirror of the profile row */
  }
}

export async function loadFavoriteDriverIds(supabase, storage, userId) {
  const local = normalizeFavoriteDriverIds(await readJson(storage, favoriteKey(userId)))
  if (!supabase || !userId) {
    return { ids: local, source: local.length ? 'phone' : 'none', note: local.length ? 'Saved on this phone.' : null }
  }
  const res = await supabase.from('profiles').select('favorite_driver_ids').eq('id', userId).maybeSingle()
  if (res.error && /favorite_driver_ids|column|schema cache/i.test(res.error.message || '')) {
    return { ids: local, source: local.length ? 'phone' : 'none', note: local.length ? 'Saved on this phone.' : null }
  }
  if (res.error) {
    return { ids: local, source: local.length ? 'phone' : 'none', note: local.length ? 'Saved on this phone.' : null }
  }
  const remote = normalizeFavoriteDriverIds(res.data?.favorite_driver_ids)
  if (remote.length) {
    await writeJson(storage, favoriteKey(userId), remote)
    return { ids: remote, source: 'account', note: null }
  }
  if (local.length) return { ids: local, source: 'phone', note: 'Saved on this phone.' }
  return { ids: [], source: 'none', note: null }
}

export async function saveFavoriteDriverIds(supabase, storage, userId, ids) {
  const next = normalizeFavoriteDriverIds(ids)
  await writeJson(storage, favoriteKey(userId), next)
  if (!supabase || !userId) {
    return { ids: next, persisted: false, note: 'Saved on this phone.' }
  }
  const { error } = await supabase
    .from('profiles')
    .update({ favorite_driver_ids: next, updated_at: new Date().toISOString() })
    .eq('id', userId)
  if (error) return { ids: next, persisted: false, note: 'Saved on this phone.' }
  return { ids: next, persisted: true, note: 'Saved to your account.' }
}

function rowsLookLikeCards(rows) {
  return Array.isArray(rows) && rows.some((row) => row && (row.full_name || row.make || row.model || row.color || row.plate))
}

/** Same car line the pick-a-driver list renders: color, make, model, then plate. */
export function pickerVehicleLine(vehicleLabel, plate) {
  const car = typeof vehicleLabel === 'string' ? vehicleLabel.trim() : ''
  const tag = plate == null || plate === false ? '' : String(plate).trim()
  if (car && tag) return `${car} · ${tag}`
  return car || tag
}

function partsFromCardRows(rows) {
  const profiles = []
  const vehicles = []
  for (const row of rows) {
    const id = row?.id
    if (!id) continue
    profiles.push({
      id,
      full_name: row.full_name || null,
      avatar_url: row.avatar_url || null,
      rating_avg: row.rating_avg,
      rating_count: row.rating_count,
      standing: row.standing || null,
      dispatchRank: Number.isInteger(row.dispatchRank) ? row.dispatchRank : undefined,
    })
    if (row.make || row.model || row.color || row.plate) {
      vehicles.push({
        driver_id: id,
        color: row.color || null,
        make: row.make || null,
        model: row.model || null,
        plate: row.plate || null,
        tier: row.tier || 'standard',
      })
    }
  }
  return profiles.length ? { profiles, vehicles } : null
}

function rpcMissingDriverCards(error) {
  const msg = `${error?.message || ''} ${error?.details || ''} ${error?.code || ''}`
  return /could not find the function|schema cache|PGRST202|does not exist/i.test(msg)
}

/**
 * Name and vehicle for the picker. Direct profile and vehicle selects are hidden
 * until a trip is accepted, so the card would otherwise read "Driver" / "Vehicle TBD".
 */
async function overlayDispatchRanks(supabase, parts) {
  if (!parts?.profiles?.length) return parts
  const ids = parts.profiles.map((profile) => profile.id).filter(Boolean)
  try {
    const data = await authedJson(supabase, '/api/driver?action=cards', {
      method: 'POST',
      body: { ids },
    })
    const rows = Array.isArray(data?.drivers) ? data.drivers : []
    const rankById = {}
    for (const row of rows) {
      if (row?.id && Number.isInteger(row.dispatchRank)) rankById[row.id] = row.dispatchRank
    }
    return {
      ...parts,
      profiles: parts.profiles.map((profile) => (
        rankById[profile.id] == null ? profile : { ...profile, dispatchRank: rankById[profile.id] }
      )),
    }
  } catch {
    return parts
  }
}

async function loadDriverCardRows(supabase, ids) {
  let missing = false
  try {
    const { data, error } = await supabase.rpc('list_driver_cards', { ids })
    if (!error && rowsLookLikeCards(data)) return partsFromCardRows(data)
    if (error && rpcMissingDriverCards(error)) missing = true
  } catch (err) {
    if (rpcMissingDriverCards(err)) missing = true
  }
  if (!missing) return null
  try {
    const data = await authedJson(supabase, '/api/driver?action=cards', {
      method: 'POST',
      body: { ids },
    })
    const rows = data?.drivers
    if (rowsLookLikeCards(rows)) return partsFromCardRows(rows)
  } catch {
    return null
  }
  return null
}

async function loadPickerCardParts(supabase, ids) {
  const parts = await loadDriverCardRows(supabase, ids)
  if (!parts) return null
  return overlayDispatchRanks(supabase, parts)
}

/**
 * Name and vehicle for a driver the rider already accepted.
 * Uses the same list_driver_cards / driver-cards path as Pick a driver.
 */
export async function loadPickerDriverRecord(supabase, driverId) {
  if (!supabase || !driverId) return null
  const parts = await loadDriverCardRows(supabase, [driverId])
  if (!parts) return null
  const profile = (parts.profiles || []).find((row) => row.id === driverId) || null
  const vehicle = (parts.vehicles || []).find((row) => row.driver_id === driverId) || null
  if (!profile && !vehicle) return null
  return {
    full_name: profile?.full_name || null,
    avatar_url: profile?.avatar_url || null,
    vehicle: vehicle || null,
  }
}

/** Older clients sent riders to Schedule after airport_deposit_required. New requests book with no upfront deposit. */
export function scheduleRedirectForRequestError(err, destLabel) {
  if (err?.code !== 'airport_deposit_required') return null
  return { screen: 'schedule', airport: airportCodeFromLabel(destLabel) }
}

async function loadProfiles(supabase, ids) {
  let profileRes = await supabase.from('profiles').select(PROFILE_COLUMNS).in('id', ids)
  if (profileRes.error && /standing|rating_avg|rating_count|column|schema cache/i.test(profileRes.error.message || '')) {
    profileRes = await supabase.from('profiles').select(PROFILE_COLUMNS_NARROW).in('id', ids)
  }
  return profileRes
}

function mapDrivers(statuses, profiles, vehicles) {
  const profileById = Object.fromEntries((profiles || []).map((p) => [p.id, p]))
  const vehicleByDriver = {}
  for (const vehicle of vehicles || []) {
    if (!vehicleByDriver[vehicle.driver_id]) vehicleByDriver[vehicle.driver_id] = vehicle
  }
  return (statuses || []).map((status) => {
    const profile = profileById[status.driver_id] || {}
    const vehicle = vehicleByDriver[status.driver_id] || null
    const standing = profile.standing || standingFromRatings(profile.rating_avg, profile.rating_count)
    if (standing === 'restricted') return null
    return {
      id: status.driver_id,
      name: displayFirstName(profile.full_name, 'Driver'),
      ratingAvg: profile.rating_avg != null ? Number(profile.rating_avg) : null,
      ratingCount: Number(profile.rating_count) || 0,
      standing,
      phone: profile.phone || null,
      avatarUrl: profile.avatar_url || null,
      online: Boolean(status.online),
      priorityMode: Boolean(status.priority_mode),
      lat: status.lat ?? null,
      lng: status.lng ?? null,
      heading: status.heading ?? null,
      unlockProgress: status.unlock_progress ?? null,
      unlockTarget: status.unlock_target ?? null,
      updatedAt: status.updated_at || null,
      vehicle,
      vehicleLabel: vehicle
        ? [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ')
        : 'Vehicle TBD',
      plate: vehicle?.plate || null,
      comfortClass: vehicleServesComfort(vehicle),
      isDemo: false,
      tier: vehicle?.tier || 'standard',
      dispatchRank: Number.isInteger(profile.dispatchRank)
        ? profile.dispatchRank
        : defaultDriverRank(profile.email),
    }
  }).filter(Boolean)
}

async function approvedIdSet(supabase, ids) {
  const { data, error } = await supabase.rpc('list_approved_driver_ids', { ids })
  if (error) return { approved: null, error: error.message }
  return { approved: new Set((data || []).map((row) => row.profile_id)), error: null }
}

/** Drop ids whose application row is positively not approved. One query for the list. */
async function positivelyUnapprovedIds(supabase, ids) {
  if (!ids.length) return new Set()
  try {
    const pending = supabase
      .from('driver_applications')
      .select('profile_id, onboarding_status')
      .in('profile_id', ids)
    if (!pending || typeof pending.then !== 'function') return new Set()
    const { data, error } = await pending
    if (error || !Array.isArray(data)) return new Set()
    const blocked = new Set()
    for (const row of data) {
      if (row?.profile_id && !canReceiveRides(row.onboarding_status)) blocked.add(row.profile_id)
    }
    return blocked
  } catch {
    return new Set()
  }
}

async function visibleApprovedIds(supabase, ids) {
  const { approved, error } = await approvedIdSet(supabase, ids)
  if (error || !approved) return { approved, error }
  const blocked = await positivelyUnapprovedIds(supabase, ids)
  if (!blocked.size) return { approved, error: null }
  const next = new Set([...approved].filter((id) => !blocked.has(id)))
  return { approved: next, error: null }
}

export async function fetchOnlineDrivers(supabase) {
  if (!supabase) return { drivers: [], error: 'Supabase not configured' }

  const { data: statuses, error: statusErr } = await supabase
    .from('driver_status')
    .select(STATUS_COLUMNS)
    .eq('online', true)

  if (statusErr) return { drivers: [], error: statusErr.message }
  // Map-only rush cars are not selectable, even if a stray status row uses their id.
  const liveStatuses = (statuses || []).filter((row) => row?.driver_id && !isSimulatedDriverId(row.driver_id))
  if (!liveStatuses.length) return { drivers: [], error: null }

  const ids = liveStatuses.map((row) => row.driver_id)
  const { approved, error: approvedErr } = await visibleApprovedIds(supabase, ids)
  if (approvedErr) return { drivers: [], error: approvedErr }
  const visible = liveStatuses.filter((row) => approved.has(row.driver_id))
  if (!visible.length) return { drivers: [], error: null }

  const visibleIds = visible.map((row) => row.driver_id)
  const cardParts = await loadPickerCardParts(supabase, visibleIds)
  if (cardParts) return { drivers: mapDrivers(visible, cardParts.profiles, cardParts.vehicles), error: null }

  const vehicleQuery = supabase.from('vehicles').select(VEHICLE_COLUMNS).in('driver_id', visibleIds)
  const profileRes = await loadProfiles(supabase, visibleIds)
  const { data: vehicles } = await vehicleQuery
  if (profileRes.error) return { drivers: [], error: profileRes.error.message }
  return { drivers: mapDrivers(visible, profileRes.data, vehicles), error: null }
}

/** Saved drivers, including ones who are offline. Unapproved ids are omitted. */
export async function fetchDriversByIds(supabase, ids) {
  const wanted = normalizeFavoriteDriverIds(ids)
  if (!supabase) return { drivers: [], error: 'Supabase not configured' }
  if (!wanted.length) return { drivers: [], error: null }

  const { approved, error: approvedErr } = await visibleApprovedIds(supabase, wanted)
  if (approvedErr) return { drivers: [], error: approvedErr }
  const visibleIds = wanted.filter((id) => approved.has(id) && !isSimulatedDriverId(id))
  if (!visibleIds.length) return { drivers: [], error: null }

  const cardParts = await loadPickerCardParts(supabase, visibleIds)
  const [statusRes, profileRes, vehicleRes] = await Promise.all([
    supabase.from('driver_status').select(STATUS_COLUMNS).in('driver_id', visibleIds),
    cardParts ? Promise.resolve({ data: cardParts.profiles, error: null }) : loadProfiles(supabase, visibleIds),
    cardParts
      ? Promise.resolve({ data: cardParts.vehicles, error: null })
      : supabase.from('vehicles').select(VEHICLE_COLUMNS).in('driver_id', visibleIds),
  ])
  if (statusRes.error) return { drivers: [], error: statusRes.error.message }
  if (profileRes.error) return { drivers: [], error: profileRes.error.message }

  const statusById = Object.fromEntries((statusRes.data || []).map((row) => [row.driver_id, row]))
  const statuses = visibleIds.map((id) => statusById[id] || {
    driver_id: id,
    online: false,
    priority_mode: false,
    lat: null,
    lng: null,
    heading: null,
    unlock_progress: null,
    unlock_target: null,
    updated_at: null,
  })
  return { drivers: mapDrivers(statuses, profileRes.data, vehicleRes.data), error: null }
}

/**
 * Writes online (and an optional GPS fix) for this driver id only.
 * Does not create a trip, charge a card, or mark any other driver — including demo bots — online.
 */
export async function setDriverOnline(supabase, driverId, online, fix = null) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!driverId) throw new Error('Sign in required')
  if (online) {
    const { data, error: gateErr } = await supabase
      .from('driver_applications')
      .select('onboarding_status, rejection_reason')
      .eq('profile_id', driverId)
      .maybeSingle()
    if (gateErr) throw new Error(gateErr.message)
    if (data?.onboarding_status !== 'approved') {
      const err = new Error(approvalGateMessage())
      err.application = data
      throw err
    }
  }
  const row = {
    driver_id: driverId,
    online: Boolean(online),
    updated_at: new Date().toISOString(),
  }
  if (fix && Number.isFinite(Number(fix.lat)) && Number.isFinite(Number(fix.lng))) {
    row.lat = Number(fix.lat)
    row.lng = Number(fix.lng)
    if (fix.heading != null && Number.isFinite(Number(fix.heading))) row.heading = Number(fix.heading)
  }
  const { error } = await supabase.from('driver_status').upsert(row)
  if (error) throw new Error(error.message)
  return { ok: true }
}

export async function fetchDriverApplication(supabase, driverId) {
  if (!supabase || !driverId) return { application: null, error: null }
  const { data, error } = await supabase
    .from('driver_applications')
    .select('onboarding_status, rejection_reason, submitted_at')
    .eq('profile_id', driverId)
    .maybeSingle()
  if (error) return { application: null, error: error.message }
  return { application: data, error: null }
}

/**
 * Campus driver request. The server writes fare_cents and an open-pool row.
 * Client list price and isStudent are not pricing inputs.
 */
export async function requestDriverTrip(supabase, {
  riderId,
  driverId = null,
  autoAssign = false,
  dest = 'GSP Airport',
  destPoint = GSP,
  pickupLabel = 'Memorial Stadium',
  pickupPoint = STADIUM,
  tier = 'standard',
  isStudent = false,
  note = '',
}) {
  void isStudent
  if (!supabase) throw new Error('Supabase is not configured')
  if (!riderId) throw new Error('Sign in required to request a driver')
  const assigning = autoAssign === true && !driverId
  if (!driverId && !assigning) throw new Error('Select a driver first')
  if (driverId && isSimulatedDriverId(driverId)) {
    throw new Error('That driver is busy and cannot be requested.')
  }

  const destLat = destPoint?.latitude ?? destPoint?.lat
  const destLng = destPoint?.longitude ?? destPoint?.lng
  const pickupLat = pickupPoint?.latitude ?? pickupPoint?.lat
  const pickupLng = pickupPoint?.longitude ?? pickupPoint?.lng
  const riderNote = String(note || '').replace(/\s+/g, ' ').trim().slice(0, 280)

  const data = await authedJson(supabase, '/api/stripe-payment-methods?action=request-driver', {
    method: 'POST',
    body: {
      ...(assigning ? { autoAssign: true } : { driverId }),
      dest,
      destLat,
      destLng,
      pickupLabel,
      pickupLat,
      pickupLng,
      tier: tier || 'standard',
      ...(riderNote ? { note: riderNote } : {}),
    },
  })
  if (!data?.trip?.id) throw new Error('Could not request trip')
  return data.trip
}
