let createClient = null
try {
  const mod = await import('@supabase/supabase-js')
  createClient = mod.createClient
} catch {
  // Gracefully handle environments without @supabase/supabase-js
}
import { fetchOnlineDrivers as fetchSharedOnlineDrivers } from '../../packages/rides-native/drivers.js'

const env = import.meta.env || {}
const url =
  env.VITE_SUPABASE_URL ||
  env.NEXT_PUBLIC_SUPABASE_URL ||
  'https://awktabuhijrshmsmagpq.supabase.co'
const key = (
  env.VITE_SUPABASE_ANON_KEY ||
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
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
 * Shared with the rider app. No demo / simulated fleet arrays.
 */
export async function fetchOnlineDrivers() {
  return fetchSharedOnlineDrivers(supabase)
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
