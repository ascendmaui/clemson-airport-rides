/**
 * POST /api/driver?action=backup-queue
 * Driver accept, confirm, navigate, and early cancel for the backup queue.
 * Rides without a backup booking return useScheduledRpc so the existing
 * accept_scheduled_trip path stays in place.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { releaseOpenFareHold } from '../fareAuthorization.js'
import {
  acceptBackupSlot,
  cancelBackupPrimary,
  confirmBackupTrip,
  releaseBackupDriver,
} from '../backupDriverDispatch.js'

export default async function handleBackupQueue(req, res, deps = {}) {
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
  const op = String(body.op || 'accept')
  const now = deps.now ? new Date(deps.now) : new Date()

  if (op === 'accept') {
    const gate = await sb.from('driver_applications').select('onboarding_status').eq('profile_id', user.id).maybeSingle()
    if (gate.error) return json(res, 500, { error: gate.error.message })
    if (gate.data?.onboarding_status !== 'approved') {
      return json(res, 403, { error: 'Finish approval to go online. Your account is still under review.' })
    }
    const result = await acceptBackupSlot(sb, { tripId, driverId: user.id, now })
    if (!result.ok) return json(res, result.status || 409, { error: result.error, code: result.code || null })
    return json(res, 200, result)
  }
  if (op === 'confirm' || op === 'navigate') {
    const result = await confirmBackupTrip(sb, {
      tripId,
      driverId: user.id,
      navigate: op === 'navigate' || body.navigate === true,
      now,
    })
    if (!result.ok) return json(res, result.status || 409, { error: result.error })
    return json(res, 200, result)
  }
  if (op === 'cancel') {
    const result = await cancelBackupPrimary(sb, { tripId, driverId: user.id, now })
    if (!result.ok) return json(res, result.status || 409, { error: result.error })
    // Promotion and urgent-pool fallback continue the ride and keep its hold.
    try {
      const loaded = await sb.from('trips').select('id, status, metadata').eq('id', tripId).maybeSingle()
      if (loaded.error) console.error('[backup-queue] cancel reload', loaded.error.message)
      if (['canceled', 'canceled_midride', 'cancelled_wait'].includes(loaded.data?.status)) {
        await releaseOpenFareHold({ sb, stripe: deps.stripe, trip: loaded.data, reason: 'backup_cancel' })
      }
    } catch (error) {
      console.error('[backup-queue] cancel hold release', tripId, error?.message || error)
    }
    return json(res, 200, result)
  }
  if (op === 'release') {
    const result = await releaseBackupDriver(sb, { tripId, driverId: user.id, now })
    if (!result.ok) return json(res, result.status || 409, { error: result.error })
    return json(res, 200, result)
  }
  const unknown = op
  return json(res, 400, { error: `Unknown backup queue action: ${unknown}` })
}
