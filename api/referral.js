/**
 * GET/POST /api/referral
 * Signed-in rider or driver: mint share code, balance, first-name referral list.
 */
import { admin, cors, json, userFromAuth } from '../server/friendRideLib.js'
import { referralSummary } from '../server/referralService.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  try {
    const result = await referralSummary(sb, user.id)
    return json(res, result.status, result.body)
  } catch (err) {
    console.error('[referral]', err)
    return json(res, 500, { error: err.message || 'Could not load referral code' })
  }
}
