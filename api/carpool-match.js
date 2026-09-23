/**
 * POST /api/carpool-match
 * Enqueue the signed-in rider and match up to 4 overlapping campus hops.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../server/friendRideLib.js'
import { ambassadorFrom, matchRider } from '../server/carpoolService.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  if (!body.pickup?.lat || !body.dropoff?.lat) {
    return json(res, 400, { error: 'pickup and dropoff with lat/lng are required' })
  }
  try {
    const result = await matchRider(sb, {
      user,
      pickup: body.pickup,
      dropoff: body.dropoff,
      departAt: body.departAt || null,
      displayName: body.displayName,
      partyType: body.partyType === 'tailgate' ? 'tailgate' : 'carpool',
      ambassadorCode: ambassadorFrom(body),
    })
    return json(res, result.ok === false ? 400 : 200, result)
  } catch (err) {
    console.error('[carpool-match]', err)
    return json(res, 500, { error: err.message || 'Match failed' })
  }
}
