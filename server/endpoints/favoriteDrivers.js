/**
 * GET or POST /api/stripe-payment-methods?action=favorite-drivers
 * Persists favorite drivers for the signed-in rider.
 * Preview cars are dropped and removed from pass preferences.
 * ops: list, set
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { ensureProfile } from '../ensureProfile.js'
import { loadRiderPass, saveFavoriteDrivers } from '../riderPass.js'

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const now = deps.now instanceof Date ? deps.now : new Date()

  let body = {}
  if (req.method === 'POST') {
    const parsed = parseBody(req)
    if (parsed.error) return json(res, 400, { error: parsed.error })
    body = parsed.body || {}
  }
  const op = String(body.op || 'list')
  const runEnsure = deps.ensureProfile || ensureProfile

  try {
    if (op === 'set') {
      const profile = await runEnsure(sb, user)
      if (!profile?.ok) return json(res, 500, { error: 'Could not create your rider profile', code: 'profile_missing' })
    }
    if (req.method === 'GET' || op === 'list') return json(res, 200, await loadRiderPass(sb, user.id, now))
    if (op === 'set') {
      const ids = body.driverIds || body.driver_ids || body.favoriteDriverIds || []
      return json(res, 200, await saveFavoriteDrivers(sb, user.id, ids, now))
    }
    return json(res, 400, { error: 'Unknown favorite action. Use list or set.' })
  } catch (error) {
    return json(res, error.status || 500, { error: error.message || 'Could not save favorite drivers' })
  }
}
