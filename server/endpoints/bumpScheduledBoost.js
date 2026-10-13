/**
 * POST /api/stripe-payment-methods?action=bump-scheduled-boost
 * Raise the driver boost while the scheduled ride is still unaccepted.
 * The card hold, when one is already open, is incremented or replaced.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { syncBoostAuthorization } from '../fareAuthorization.js'
import { loadTripForBoost, updateTripBoost } from '../scheduledBoostStore.js'
import { boostIsEditable, parseBoostBump, readBoostCents } from '../../shared/scheduledBoost.js'

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = deps.sb || admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const tripId = String(body.tripId || body.trip_id || '').trim()
  if (!tripId) return json(res, 400, { error: 'Choose a scheduled ride.' })

  const loaded = await loadTripForBoost(sb, tripId)
  if (loaded.error) return json(res, 500, { error: loaded.error.message || 'Could not load ride' })
  const trip = loaded.data
  if (!trip || trip.rider_id !== user.id) return json(res, 404, { error: 'Scheduled ride not found.' })
  if (!boostIsEditable(trip)) {
    return json(res, 409, { error: 'A driver already accepted this ride. The boost is locked.', code: 'boost_locked' })
  }

  const current = readBoostCents(trip)
  const parsed = parseBoostBump(body.boostCents ?? body.boost_cents, current)
  if (!parsed.ok) return json(res, 400, { error: parsed.error, code: 'boost_invalid' })

  const saved = await updateTripBoost(sb, trip.id, {
    boostCents: parsed.cents,
    metadata: trip.metadata,
    match: {
      riderId: user.id,
      statuses: ['scheduled', 'searching', 'offered'],
      unassigned: true,
    },
  })
  if (saved.error) return json(res, 500, { error: saved.error.message || 'Could not update boost' })
  if (!saved.data) {
    return json(res, 409, { error: 'A driver already accepted this ride. The boost is locked.', code: 'boost_locked' })
  }

  let hold = { ok: true, skipped: true, reason: 'no_open_hold' }
  try {
    hold = await (deps.syncBoostAuthorization || syncBoostAuthorization)({
      sb,
      stripe: deps.stripe,
      trip: { ...trip, ...saved.data, metadata: saved.metadata || saved.data.metadata || trip.metadata },
      boostCents: parsed.cents,
    })
  } catch (error) {
    console.error('[bump-scheduled-boost]', trip.id, error?.message || error)
    hold = { ok: false, reason: 'hold_update_failed' }
  }

  return json(res, 200, {
    ok: true,
    tripId: trip.id,
    boostCents: parsed.cents,
    previousBoostCents: current,
    hold,
  })
}
