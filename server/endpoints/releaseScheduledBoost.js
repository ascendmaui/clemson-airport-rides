/**
 * POST /api/stripe-payment-methods?action=release-scheduled-boost
 * After the rider cancels a boosted scheduled ride, drop the open card hold
 * immediately. The hold covers the fare estimate and the boost together.
 * Canceled rides release the fare hold even without a boost.
 */
import { admin, cors, json, parseBody, userFromAuth } from '../friendRideLib.js'
import { releaseOpenFareHold } from '../fareAuthorization.js'
import { loadTripForBoost } from '../scheduledBoostStore.js'
import { readBoostCents } from '../../shared/scheduledBoost.js'

const RELEASABLE = new Set(['canceled', 'scheduled', 'searching', 'offered', 'accepted'])

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
  if (!RELEASABLE.has(trip.status)) {
    return json(res, 409, { error: 'This ride can no longer release a boost hold.', code: 'boost_hold_locked' })
  }
  if (trip.status !== 'canceled' && readBoostCents(trip) <= 0) {
    return json(res, 200, { ok: true, skipped: true, reason: 'no_boost' })
  }

  let hold = { ok: true, skipped: true, reason: 'no_open_hold' }
  try {
    hold = await (deps.releaseOpenFareHold || releaseOpenFareHold)({
      sb,
      stripe: deps.stripe,
      trip,
      reason: 'rider_cancel',
    })
  } catch (error) {
    console.error('[release-scheduled-boost]', trip.id, error?.message || error)
    hold = { ok: false, reason: 'hold_release_failed' }
  }
  if (hold?.ok === false) {
    console.error('[release-scheduled-boost] hold release failed', trip.id)
  }

  return json(res, 200, { ok: true, tripId: trip.id, hold })
}
