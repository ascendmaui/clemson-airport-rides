/**
 * POST /api/rider-live
 * High-accuracy pickup stream from the rider to the offered or matched driver.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../server/friendRideLib.js'
import { publishRiderPickup } from '../server/endpoints/riderLivePickup.js'

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await (deps.userFromAuth || userFromAuth)(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const parsed = parseBody(req)
  if (parsed.error) return json(res, 400, { error: parsed.error })

  try {
    const publishFn = deps.publishRiderPickup || publishRiderPickup
    const result = await publishFn(sb, user, parsed.body, deps.opts)
    return json(res, result.status, result.body)
  } catch (err) {
    if ((err.status || 500) >= 500) console.error('[rider-live]', err)
    return json(res, err.status || 500, { error: err.message || 'Could not update pickup location' })
  }
}
