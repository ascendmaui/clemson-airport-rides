/**
 * POST /api/trip-wait
 * Body: { action: 'arrive'|'tick'|'cancel'|'start'|'complete', tripId }
 * Driver arrives, both sides tick the clock, driver may cancel after 5:00,
 * the server auto-cancels at 7:00. arrived_at is stamped in Postgres.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { applyTripWait } from '../tripWait.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const parsed = parseBody(req)
  if (parsed.error) return json(res, 400, { error: parsed.error })
  const action = parsed.body.action
  const tripId = parsed.body.tripId || parsed.body.trip_id

  try {
    const result = await applyTripWait(sb, { action, tripId, actorId: user.id })
    return json(res, 200, result)
  } catch (err) {
    const status = err.status || 500
    return json(res, status, { error: err.message || 'Wait update failed' })
  }
}
