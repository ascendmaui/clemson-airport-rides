/** GET /api/credits — balance and FIFO lots for the signed-in rider. */
import { admin, cors, json, userFromAuth } from '../friendRideLib.js'
import { loadCreditLots, creditBalanceCents } from '../creditLots.js'
import { CREDIT_PACKS } from '../../src/lib/fareRates.js'

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET') {
    res.setHeader?.('Allow', 'GET, OPTIONS')
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 405, { error: 'Method not allowed' })
  }

  const sb = deps.sb !== undefined ? deps.sb : (deps.admin ? deps.admin() : admin())
  if (!sb) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  }

  const user = deps.user !== undefined ? deps.user : await (deps.userFromAuth || userFromAuth)(req, sb)
  if (!user) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 401, { error: 'Sign in required' })
  }

  try {
    const loadLotsFn = deps.loadCreditLots || loadCreditLots
    const balanceFn = deps.creditBalanceCents || creditBalanceCents
    const [lots, balanceCents] = await Promise.all([
      loadLotsFn(sb, user.id),
      balanceFn(sb, user.id),
    ])
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 200, { balanceCents, lots, packs: CREDIT_PACKS })
  } catch (err) {
    res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    return json(res, 500, { error: err.message || 'Could not load credits' })
  }
}
