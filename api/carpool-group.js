/**
 * POST /api/carpool-group
 * One-tap shared link. Friends join the existing /carpool/:token lobby.
 * driving=true assigns the organizer as the student driver.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../server/friendRideLib.js'
import { ambassadorFrom, createGroupRide } from '../server/carpoolService.js'

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
    const result = await createGroupRide(sb, {
      user,
      pickup: body.pickup,
      dropoff: body.dropoff,
      displayName: body.displayName,
      partyType: body.partyType === 'tailgate' ? 'tailgate' : 'carpool',
      driving: Boolean(body.driving),
      ambassadorCode: ambassadorFrom(body),
    })
    return json(res, 200, result)
  } catch (err) {
    console.error('[carpool-group]', err)
    return json(res, 500, { error: err.message || 'Could not create group link' })
  }
}
