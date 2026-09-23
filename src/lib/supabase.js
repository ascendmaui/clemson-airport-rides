import { createClient } from '@supabase/supabase-js'

const url =
  import.meta.env.VITE_SUPABASE_URL ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://awktabuhijrshmsmagpq.supabase.co'
const key = (
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  ''
).trim()

export const supabaseConfigured = Boolean(url && key)

export const supabase = supabaseConfigured
  ? createClient(url, key, {
      realtime: { params: { eventsPerSecond: 8 } },
    })
  : null

export async function pingSupabase() {
  if (!supabase) return { ok: false, reason: 'missing VITE_SUPABASE_ANON_KEY' }
  try {
    const { error } = await supabase.from('profiles').select('id').limit(1)
    if (error && error.code !== 'PGRST116') {
      return { ok: false, reason: error.message }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: String(e) }
  }
}

/**
 * Online drivers from driver_status + profiles + vehicles.
 * No demo / simulated fleet arrays.
 */
export async function fetchOnlineDrivers() {
  if (!supabase) {
    return { drivers: [], error: 'Supabase not configured' }
  }

  const { data: statuses, error: statusErr } = await supabase
    .from('driver_status')
    .select('driver_id, online, priority_mode, lat, lng, heading, unlock_progress, unlock_target, updated_at')
    .eq('online', true)

  if (statusErr) {
    return { drivers: [], error: statusErr.message }
  }
  if (!statuses?.length) {
    return { drivers: [], error: null }
  }

  const ids = statuses.map((s) => s.driver_id)
  const { data: approvedRows, error: approvedErr } = await supabase.rpc('list_approved_driver_ids', { ids })
  if (approvedErr) {
    return { drivers: [], error: approvedErr.message }
  }
  const approved = new Set((approvedRows || []).map((row) => row.profile_id))
  const visible = statuses.filter((s) => approved.has(s.driver_id))
  if (!visible.length) {
    return { drivers: [], error: null }
  }

  const visibleIds = visible.map((s) => s.driver_id)

  const [{ data: profiles }, { data: vehicles }] = await Promise.all([
    supabase
      .from('profiles')
      .select('id, full_name, phone, email, avatar_url, role')
      .in('id', visibleIds),
    supabase
      .from('vehicles')
      .select(
        'id, driver_id, make, model, color, plate, seats, is_tesla, autonomous_capable, tier',
      )
      .in('driver_id', visibleIds),
  ])

  const profileById = Object.fromEntries((profiles || []).map((p) => [p.id, p]))
  const vehicleByDriver = {}
  for (const v of vehicles || []) {
    if (!vehicleByDriver[v.driver_id]) vehicleByDriver[v.driver_id] = v
  }

  const drivers = visible.map((s) => {
    const profile = profileById[s.driver_id] || {}
    const vehicle = vehicleByDriver[s.driver_id] || null
    return {
      id: s.driver_id,
      name: profile.full_name || 'Driver',
      phone: profile.phone || null,
      avatarUrl: profile.avatar_url || null,
      online: s.online,
      priorityMode: s.priority_mode,
      lat: s.lat,
      lng: s.lng,
      heading: s.heading,
      unlockProgress: s.unlock_progress,
      unlockTarget: s.unlock_target,
      vehicle,
      vehicleLabel: vehicle
        ? [vehicle.color, vehicle.make, vehicle.model].filter(Boolean).join(' ')
        : 'Vehicle TBD',
      plate: vehicle?.plate || null,
      isTesla: Boolean(vehicle?.is_tesla),
      tier: vehicle?.tier || 'standard',
      updatedAt: s.updated_at,
    }
  })

  return { drivers, error: null }
}

/** Subscribe to trips Realtime changes. Returns unsubscribe fn. */
export function subscribeTrips(onChange) {
  if (!supabase) return () => {}
  const channel = supabase
    .channel('trips-realtime')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'trips' },
      (payload) => {
        onChange?.(payload)
      },
    )
    .subscribe()
  return () => {
    supabase.removeChannel(channel)
  }
}

export async function upsertDriverOnboarding() {
  throw new Error('Use driver onboarding. New drivers are not approved until an admin reviews their documents.')
}

export async function setDriverOnline(driverId, online) {
  if (!supabase) throw new Error('Supabase not configured')
  if (online) {
    const { data, error: gateErr } = await supabase
      .from('driver_applications')
      .select('onboarding_status')
      .eq('profile_id', driverId)
      .maybeSingle()
    if (gateErr) throw new Error(gateErr.message)
    if (data?.onboarding_status !== 'approved') {
      throw new Error('Admin approval is required before you can go online.')
    }
  }
  const { error } = await supabase
    .from('driver_status')
    .upsert({
      driver_id: driverId,
      online: Boolean(online),
      updated_at: new Date().toISOString(),
    })
  if (error) throw new Error(error.message)
  return { ok: true }
}
