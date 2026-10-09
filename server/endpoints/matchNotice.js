/**
 * GET or POST /api/stripe-payment-methods?action=match-notice&tripId=
 * Rider match card: driver first name, distance from pickup, pickup time.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { isSimulatedDriverId } from '../../packages/rides-native/simulatedDrivers.js'
import { approachFromPoints, buildRiderMatchNotice, locationIsFresh } from '../../shared/nearTermSlots.js'

const MATCHED = new Set(['accepted', 'arriving', 'arrived', 'in_progress'])

function tripIdFrom(req, body) {
  const url = new URL(req.url || '/', 'http://localhost')
  return String(body?.tripId || body?.trip_id || url.searchParams.get('tripId') || url.searchParams.get('trip_id') || '').trim()
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = deps.sb || admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const now = deps.now instanceof Date ? deps.now : new Date()

  let body = {}
  if (req.method === 'POST') {
    const parsed = parseBody(req)
    if (parsed.error) return json(res, 400, { error: parsed.error })
    body = parsed.body || {}
  }
  const tripId = tripIdFrom(req, body)
  if (!tripId) return json(res, 400, { error: 'Missing trip' })

  const tripRes = await sb.from('trips').select('id, status, rider_id, driver_id, pickup_label, dropoff_label, pickup_lat, pickup_lng, pickup_at, scheduled_for, metadata').eq('id', tripId).maybeSingle()
  if (tripRes.error) return json(res, 500, { error: tripRes.error.message || 'Could not read trip' })
  const trip = tripRes.data
  if (!trip || trip.rider_id !== user.id) return json(res, 404, { error: 'Ride not found' })
  if (!MATCHED.has(String(trip.status || '')) || !trip.driver_id) {
    return json(res, 409, { error: 'No driver is matched yet.', code: 'not_matched' })
  }
  if (isSimulatedDriverId(trip.driver_id)) {
    return json(res, 409, { error: 'A preview car cannot be matched to this ride.', code: 'demo_driver' })
  }

  const [profileRes, statusRes] = await Promise.all([
    sb.from('profiles').select('id, full_name').eq('id', trip.driver_id).maybeSingle(),
    sb.from('driver_status').select('driver_id, lat, lng, updated_at, location_updated_at').eq('driver_id', trip.driver_id).maybeSingle(),
  ])
  const status = statusRes.data
  const fresh = status && locationIsFresh({
    lat: status.lat,
    lng: status.lng,
    updated_at: status.location_updated_at || status.updated_at,
  }, now)
  const approach = fresh
    ? approachFromPoints(status, { lat: trip.pickup_lat, lng: trip.pickup_lng })
    : null
  const pickupAt = trip.pickup_at || trip.scheduled_for || trip.metadata?.scheduled_pickup_at || null
  const notice = buildRiderMatchNotice({
    driverName: profileRes.data?.full_name,
    distanceMi: approach?.distanceMi ?? null,
    etaMin: approach?.etaMin ?? null,
    pickupAt,
    now,
  })
  return json(res, 200, {
    tripId: trip.id,
    status: trip.status,
    pickupLabel: trip.pickup_label || null,
    dropoffLabel: trip.dropoff_label || null,
    ...notice,
  })
}
