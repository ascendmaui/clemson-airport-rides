/**
 * POST /api/referral-qualify
 * Credit grant hook. Idempotent. Amounts come from server/referralCredits.js,
 * never from the client body. The trips trigger calls the same SQL function.
 * One reward grant per new user: claim_signup_reward is shared with social promo.
 * See server/signupReward.js.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../server/friendRideLib.js'
import { qualifyReferralTrip } from '../server/referralService.js'

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
    const result = await qualifyReferralTrip(sb, user.id, body.tripId || body.trip_id || '')
    return json(res, result.status, result.body)
  } catch (err) {
    console.error('[referral-qualify]', err)
    return json(res, 500, { error: err.message || 'Could not grant referral credit' })
  }
}
