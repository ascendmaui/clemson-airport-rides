/**
 * POST /api/friend-rides-recompute
 * Routes API + fare split. Graceful error if GOOGLE_MAPS_API_KEY missing.
 */
import {
  admin, cors, json, parseBody, publicRideSummary, userFromAuth, loadRideByToken,
} from '../server/friendRideLib.js'
import { recomputeRideFares } from '../server/friendRideRecompute.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const token = body.token
  if (!token) return json(res, 400, { error: 'token required' })

  try {
    let splitMode = undefined
    if (body.splitMode === 'even' || body.splitMode === 'by_distance') {
      const user = await userFromAuth(req)
      const loaded = await loadRideByToken(sb, token)
      if (loaded && user && user.id === loaded.ride.organizer_id) {
        splitMode = body.splitMode
      }
    }

    const result = await recomputeRideFares(sb, token, { splitMode })
    if (!result.ok) {
      const status = result.code === 'not_found' ? 404 : result.code === 'waypoints' ? 400 : 503
      return json(res, status, {
        error: result.error,
        code: result.code,
        message: result.message || result.error,
      })
    }

    return json(res, 200, {
      ...publicRideSummary(result.ride, result.participants),
      max_participants: result.maxParticipants,
      vehicle_label: result.vehicleLabel,
      route: result.route,
      fareHeuristic: result.fareHeuristic,
    })
  } catch (e) {
    console.error('[friend-rides-recompute]', e)
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
