/**
 * POST /api/driver?action=cards
 * Safe name and vehicle for approved drivers the picker already listed.
 */
import { admin, cors, json, parseBody } from '../friendRideLib.js'
import { loadPublicDriverCards } from '../driverCards.js'

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const loaded = await loadPublicDriverCards(sb, body?.ids)
  if (loaded.error) return json(res, 500, { error: 'Could not load drivers' })
  return json(res, 200, { drivers: loaded.drivers })
}
