/**
 * POST /api/rider-switch
 * Rider auth. Cancel a matched driver before pickup, or ask for another ride.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../server/friendRideLib.js'
import { handleRiderSwitch } from '../server/endpoints/riderSwitch.js'

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const parsed = parseBody(req)
  if (parsed.error) return json(res, 400, { error: parsed.error })

  try {
    const result = await handleRiderSwitch(sb, user, parsed.body, deps)
    return json(res, result.status, result.body)
  } catch (err) {
    console.error('[rider-switch]', err)
    return json(res, err.status || 500, { error: err.message || 'Could not update this ride' })
  }
}
