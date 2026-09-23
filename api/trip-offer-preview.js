/**
 * POST /api/trip-offer-preview
 * First name only for an open (or assigned) trip. Drivers cannot read private profiles via RLS
 * before they accept, so this is the narrow preview.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../server/friendRideLib.js'
import { displayFirstName } from '../src/lib/privacyDisplay.js'
import { standingFromRatings } from '../src/lib/standing.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const tripId = body.tripId
  if (!tripId) return json(res, 400, { error: 'tripId required' })

  const { data: status } = await sb
    .from('driver_status')
    .select('driver_id')
    .eq('driver_id', user.id)
    .maybeSingle()
  if (!status) return json(res, 403, { error: 'Drivers only' })

  const { data: trip } = await sb
    .from('trips')
    .select('id, rider_id, driver_id, status')
    .eq('id', tripId)
    .maybeSingle()
  if (!trip) return json(res, 404, { error: 'Trip not found' })

  const open = ['searching', 'offered'].includes(trip.status) && !trip.driver_id
  const mine = trip.driver_id === user.id
  if (!open && !mine) return json(res, 404, { error: 'Trip not available' })

  let riderRes = await sb
    .from('profiles')
    .select('full_name, rating_avg, rating_count, standing')
    .eq('id', trip.rider_id)
    .maybeSingle()
  if (riderRes.error && /standing|column|schema cache/i.test(riderRes.error.message || '')) {
    riderRes = await sb
      .from('profiles')
      .select('full_name, rating_avg, rating_count')
      .eq('id', trip.rider_id)
      .maybeSingle()
  }
  const rider = riderRes.data
  const standing = rider?.standing || standingFromRatings(rider?.rating_avg, rider?.rating_count)

  return json(res, 200, {
    riderFirstName: displayFirstName(rider?.full_name, 'Rider'),
    ratingAvg: rider?.rating_avg != null ? Number(rider.rating_avg) : null,
    ratingCount: Number(rider?.rating_count) || 0,
    standing,
  })
}
