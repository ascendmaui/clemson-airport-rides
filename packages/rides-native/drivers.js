import { displayFirstName, standingFromRatings } from './authErrors.js'
import { GSP, STADIUM } from './places.js'

export async function fetchOnlineDrivers(supabase) {
  if (!supabase) return { drivers: [], error: 'Supabase not configured' }

  const { data: statuses, error: statusErr } = await supabase
    .from('driver_status')
    .select('driver_id, online, priority_mode, lat, lng, heading, unlock_progress, unlock_target, updated_at')
    .eq('online', true)

  if (statusErr) return { drivers: [], error: statusErr.message }
  if (!statuses?.length) return { drivers: [], error: null }

  const ids = statuses.map((s) => s.driver_id)
  const { data: approvedRows, error: approvedErr } = await supabase.rpc('list_approved_driver_ids', { ids })
  if (approvedErr) return { drivers: [], error: approvedErr.message }

  const approved = new Set((approvedRows || []).map((row) => row.profile_id))
  const visible = statuses.filter((s) => approved.has(s.driver_id))
  if (!visible.length) return { drivers: [], error: null }

  const visibleIds = visible.map((s) => s.driver_id)
  const vehicleQuery = supabase
    .from('vehicles')
    .select('id, driver_id, make, model, color, plate, seats, is_tesla, autonomous_capable, tier')
    .in('driver_id', visibleIds)

  let profileRes = await supabase
    .from('profiles')
    .select('id, full_name, phone, email, avatar_url, role, rating_avg, rating_count, standing')
    .in('id', visibleIds)
  if (profileRes.error && /standing|rating_avg|rating_count|column|schema cache/i.test(profileRes.error.message || '')) {
    profileRes = await supabase
      .from('profiles')
      .select('id, full_name, phone, email, avatar_url, role')
      .in('id', visibleIds)
  }
  const { data: vehicles } = await vehicleQuery
  if (profileRes.error) return { drivers: [], error: profileRes.error.message }
  const profiles = profileRes.data

  const profileById = Object.fromEntries((profiles || []).map((p) => [p.id, p]))
  const vehicleByDriver = {}
  for (const v of vehicles || []) {
    if (!vehicleByDriver[v.driver_id]) vehicleByDriver[v.driver_id] = v
  }

  const drivers = visible.map((s) => {
    const profile = profileById[s.driver_id] || {}
    const vehicle = vehicleByDriver[s.driver_id] || null
    const standing = profile.standing || standingFromRatings(profile.rating_avg, profile.rating_count)
    if (standing === 'restricted') return null
    return {
      id: s.driver_id,
      name: displayFirstName(profile.full_name, 'Driver'),
      ratingAvg: profile.rating_avg != null ? Number(profile.rating_avg) : null,
      ratingCount: Number(profile.rating_count) || 0,
      standing,
      online: s.online,
      lat: s.lat,
      lng: s.lng,
      vehicleLabel: vehicle
        ? [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ')
        : 'Vehicle TBD',
      plate: vehicle?.plate || null,
      isTesla: Boolean(vehicle?.is_tesla),
      tier: vehicle?.tier || 'standard',
    }
  }).filter(Boolean)

  return { drivers, error: null }
}

export async function setDriverOnline(supabase, driverId, online) {
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
      const err = new Error('Admin approval is required before you can go online.')
      err.application = data
      throw err
    }
  }
  const { error } = await supabase.from('driver_status').upsert({
    driver_id: driverId,
    online: Boolean(online),
    updated_at: new Date().toISOString(),
  })
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

/** Same insert as src/lib/trips.js requestDriverTrip. No Stripe charge. */
export async function requestDriverTrip(supabase, {
  riderId,
  driverId,
  dest = 'GSP Airport',
  destPoint = GSP,
  pickupLabel = 'Memorial Stadium',
  pickupPoint = STADIUM,
  tier = 'standard',
}) {
  if (!supabase) throw new Error('Supabase is not configured')
  if (!riderId) throw new Error('Sign in required to request a driver')
  if (!driverId) throw new Error('Select a driver first')

  const { data, error } = await supabase
    .from('trips')
    .insert({
      rider_id: riderId,
      driver_id: driverId,
      status: 'requested',
      tier: tier || 'standard',
      pickup_label: pickupLabel,
      dropoff_label: dest,
      pickup_lat: pickupPoint.latitude,
      pickup_lng: pickupPoint.longitude,
      dropoff_lat: destPoint.latitude,
      dropoff_lng: destPoint.longitude,
      passengers: 1,
    })
    .select('id, status, driver_id, dropoff_label')
    .single()

  if (error) throw new Error(error.message || 'Could not request trip')
  return data
}
