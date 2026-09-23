/** GET /api/credits — balance and FIFO lots for the signed-in rider. */
import { admin, cors, json, userFromAuth } from '../server/friendRideLib.js'
import { loadCreditLots, creditBalanceCents } from '../server/credits.js'
import { CREDIT_PACKS } from '../src/lib/fareRates.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  try {
    const [lots, balanceCents] = await Promise.all([
      loadCreditLots(sb, user.id),
      creditBalanceCents(sb, user.id),
    ])
    return json(res, 200, { balanceCents, lots, packs: CREDIT_PACKS })
  } catch (err) {
    return json(res, 500, { error: err.message || 'Could not load credits' })
  }
}
