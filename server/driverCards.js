/**
 * Rider-facing driver cards. Service role reads past profile and vehicle RLS.
 * The response is an allowlist: name, rating, vehicle, and dispatch rank.
 * No email, phone, or Stripe ids. Email is read only to compute the rank.
 */
import { defaultDriverRank } from '../shared/driverOrder.js'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CARD_CAP = 40

const PROFILE_CARD_COLUMNS = 'id, full_name, rating_avg, rating_count, standing, email'
const VEHICLE_CARD_COLUMNS = 'driver_id, color, make, model, plate, tier, is_tesla'

export function normalizeDriverCardIds(ids) {
  const list = Array.isArray(ids) ? ids : []
  const out = []
  for (const item of list) {
    if (typeof item !== 'string') continue
    const id = item.trim()
    if (!UUID_RE.test(id) || out.includes(id)) continue
    out.push(id)
    if (out.length >= CARD_CAP) break
  }
  return out
}

function cardFrom(profile, vehicle) {
  return {
    id: profile.id,
    full_name: profile.full_name || null,
    rating_avg: profile.rating_avg ?? null,
    rating_count: profile.rating_count ?? 0,
    standing: profile.standing || null,
    color: vehicle?.color || null,
    make: vehicle?.make || null,
    model: vehicle?.model || null,
    plate: vehicle?.plate || null,
    tier: vehicle?.tier || null,
    is_tesla: vehicle?.is_tesla === true,
    dispatch_rank: defaultDriverRank(profile.email),
  }
}

export async function loadPublicDriverCards(sb, ids) {
  const wanted = normalizeDriverCardIds(ids)
  if (!sb) return { drivers: [], error: 'no_client' }
  if (!wanted.length) return { drivers: [], error: null }

  const apps = await sb
    .from('driver_applications')
    .select('profile_id')
    .in('profile_id', wanted)
    .eq('onboarding_status', 'approved')
  if (apps.error) return { drivers: [], error: apps.error.message }
  const approved = (apps.data || []).map((row) => row.profile_id).filter(Boolean)
  if (!approved.length) return { drivers: [], error: null }

  const [profiles, vehicles] = await Promise.all([
    sb.from('profiles').select(PROFILE_CARD_COLUMNS).in('id', approved),
    sb.from('vehicles').select(VEHICLE_CARD_COLUMNS).in('driver_id', approved),
  ])
  if (profiles.error) return { drivers: [], error: profiles.error.message }
  if (vehicles.error) return { drivers: [], error: vehicles.error.message }

  const vehicleByDriver = {}
  for (const vehicle of vehicles.data || []) {
    if (vehicle?.driver_id && !vehicleByDriver[vehicle.driver_id]) {
      vehicleByDriver[vehicle.driver_id] = vehicle
    }
  }
  const drivers = (profiles.data || [])
    .filter((profile) => profile?.id)
    .map((profile) => cardFrom(profile, vehicleByDriver[profile.id] || null))
  return { drivers, error: null }
}
