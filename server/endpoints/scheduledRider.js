/**
 * POST /api/stripe-payment-methods?action=scheduled-rider
 * Rider detail, switch, and cancel for a scheduled backup queue.
 * op=detail|switch|cancel. safetyReport=true is the only post-departure switch.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { backupRideDetail, cancelBackupRide, switchBackupDriver } from '../backupRiderActions.js'

export default async function handleScheduledRider(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = deps.sb !== undefined ? deps.sb : (deps.admin ? deps.admin() : admin())
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await (deps.userFromAuth || userFromAuth)(req, sb)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const { body, error: parseError } = parseBody(req)
  if (parseError) return json(res, 400, { error: parseError })
  const tripId = String(body.tripId || body.trip_id || '').trim()
  if (!tripId) return json(res, 400, { error: 'Trip id required' })
  const op = String(body.op || 'detail')
  let now = new Date()
  if (deps.now) {
    const candidate = new Date(deps.now)
    if (!Number.isNaN(candidate.getTime())) now = candidate
  }
  const safetyReport = body.safetyReport === true || body.safety_report === true || body.safetyReport === 'true' || body.safety_report === 'true'

  if (op === 'detail') {
    const result = await backupRideDetail(sb, { tripId, riderId: user.id })
    if (!result.ok) return json(res, result.status || 409, { error: result.error })
    return json(res, 200, result)
  }
  if (op === 'switch') {
    const result = await switchBackupDriver(sb, { tripId, riderId: user.id, safetyReport, now })
    if (!result.ok) return json(res, result.status || 409, { error: result.error, code: result.code || null })
    return json(res, 200, result)
  }
  if (op === 'cancel') {
    const result = await cancelBackupRide(sb, {
      tripId,
      riderId: user.id,
      now,
      settle: deps.settleFareHold,
      stripe: deps.stripe,
    })
    if (!result.ok) return json(res, result.status || 409, { error: result.error, code: result.code || null })
    return json(res, 200, result)
  }
  return json(res, 400, { error: `Unknown scheduled rider action: ${op}` })
}
