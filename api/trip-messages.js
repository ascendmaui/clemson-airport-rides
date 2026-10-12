/**
 * POST /api/trip-messages?action=message|lost-item
 * Notifies the other party. Inserts stay on trip_messages under RLS.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../server/friendRideLib.js'
import { resolveRouteAction } from '../server/routeAction.js'
import { notifyTripCounterpart } from '../server/tripMessageNotify.js'

const ACTIONS = ['message', 'lost-item']

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const action = resolveRouteAction(req, { allowed: ACTIONS, legacy: {} })
  if (!ACTIONS.includes(action)) {
    return json(res, 400, { error: 'Use action=message or action=lost-item.' })
  }
  const sb = deps.sb || admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user || await userFromAuth(req)
  if (!user?.id) return json(res, 401, { error: 'Sign in required' })
  const { body, error: parseError } = parseBody(req)
  if (parseError) return json(res, 400, { error: parseError })
  const result = await notifyTripCounterpart({
    sb,
    actorId: user.id,
    tripId: body?.tripId,
    kind: action,
    messageId: body?.messageId,
    reportId: body?.reportId,
  }, deps)
  if (!result.ok) return json(res, 403, { error: 'Could not notify the other person on this trip.' })
  return json(res, 200, {
    ok: true,
    push: result.push,
    email: result.email,
  })
}
