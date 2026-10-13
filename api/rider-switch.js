/**
 * POST /api/rider-switch
 * Rider auth. Cancel a matched driver before pickup, or ask for another ride.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../server/friendRideLib.js'
import { clientErrorMessage } from '../server/clientError.js'
import { handleRiderSwitch } from '../server/endpoints/riderSwitch.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const parsed = parseBody(req)
  if (parsed.error) return json(res, 400, { error: parsed.error })

  try {
    const result = await handleRiderSwitch(sb, user, parsed.body)
    return json(res, result.status, result.body)
  } catch (err) {
    console.error('[rider-switch]', err?.message || err)
    const status = Number(err?.status) >= 400 && Number(err?.status) < 600 ? err.status : 500
    return json(res, status, { error: clientErrorMessage(err, 'Could not update this ride') })
  }
}
