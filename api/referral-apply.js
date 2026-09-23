/**
 * POST /api/referral-apply
 * Attach a share code to a new rider or driver before their first completed trip.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../server/friendRideLib.js'
import { applyReferralCode } from '../server/referralService.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  try {
    const result = await applyReferralCode(sb, user.id, body.code || body.ref || '')
    return json(res, result.status, result.body)
  } catch (err) {
    console.error('[referral-apply]', err)
    return json(res, 500, { error: err.message || 'Could not apply referral code' })
  }
}
