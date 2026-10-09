/**
 * POST /api/driver?action=tip-choice
 * Body: { mode: 'offer' | 'record', tripId, choiceId?, customDollars? }
 * choiceId "custom" stores the server-priced typed amount.
 * Client fare, deposit, amount, total, and isStudent are ignored.
 * Records the rider's tip choice and bills a saved card from the stored amount.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { applyRiderTipChoice } from '../riderTipChoice.js'

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
    const result = await applyRiderTipChoice(sb, user, parsed.body)
    return json(res, result.status, result.body)
  } catch (err) {
    console.error('[tip-choice]', err)
    return json(res, err.status || 500, { error: err.message || 'Tip choice failed' })
  }
}
