import { admin, cors, json, parseBody, stripeClient, userFromAuth } from '../friendRideLib.js'
import { resolveDriverTransition } from '../../shared/tripTransitions.js'
import { offerVisibleToDriver, unchangedOfferQuery } from '../../shared/driverOrder.js'
import { lockedOfferEconomics } from '../../packages/rides-native/offerLadder.js'
import { isUnpaidAirportDepositTrip, UNPAID_AIRPORT_DEPOSIT_ACCEPT_ERROR } from '../../packages/rides-native/tripTags.js'
import { WOMEN_ONLY_ACCEPT_ERROR } from '../../shared/womenOnlyMatch.js'
import { applyTripWait } from '../tripWait.js'
import { settleTrip } from '../tripSettle.js'
import { insertTripEvent } from '../tripEvents.js'

export default async function handleTripStatus(req, res, deps = {}) {
  if (cors(req, res)) return
  const fail = (http, code, error = code) => json(res, http, { ok: false, code, error })
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Method not allowed')
  const sb = deps.sb !== undefined ? deps.sb : admin()
  if (!sb) return fail(503, 'service_unavailable', 'Service unavailable')
  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return fail(401, 'auth_required', 'Sign in required')
  const { body, error } = parseBody(req)
  if (error) return fail(400, 'invalid_body', error)
  const { tripId, op } = body
  if (typeof tripId !== 'string' || !tripId.trim()) return fail(400, 'trip_id_required', 'tripId required')
  if (resolveDriverTransition({ op }).error === 'invalid_op') return fail(400, 'invalid_op', 'Unknown trip action')

  try {
    const read = await sb.from('trips').select('*').eq('id', tripId).maybeSingle()
    if (read.error) throw read.error
    const trip = read.data
    if (!trip) return fail(404, 'trip_not_found', 'Trip not found')
    // Authorization precedes idempotency: a rider cannot replay a driver action.
    if (trip.rider_id === user.id || (op !== 'accept' && trip.driver_id !== user.id)) {
      return fail(403, 'forbidden', 'Not allowed on this trip')
    }
    if (op === 'accept') {
      const gate = await sb.from('driver_applications').select('onboarding_status').eq('profile_id', user.id).maybeSingle()
      if (gate.error) throw gate.error
      if (gate.data?.onboarding_status !== 'approved') {
        return fail(403, 'driver_not_approved', 'Finish approval to go online. Your account is still under review.')
      }
      const presence = await sb.from('driver_status').select('online').eq('driver_id', user.id).maybeSingle()
      if (presence.error) throw presence.error
      if (!presence.data?.online) return fail(409, 'driver_offline', 'Go online before accepting a ride.')
      if (!offerVisibleToDriver(trip, user.id)) return fail(409, 'offer_unavailable', 'That ride is no longer available')
      const pair = await sb.rpc('women_only_pair_allowed', { p_rider: trip.rider_id, p_driver: user.id })
      // Only an absent optional RPC is ignored. Operational failures fail closed.
      if (pair.error && !['PGRST202', '42883'].includes(pair.error.code)) throw pair.error
      if (pair.data === false) return fail(403, 'pair_not_allowed', WOMEN_ONLY_ACCEPT_ERROR)
      if (isUnpaidAirportDepositTrip(trip)) return fail(409, 'airport_deposit_unpaid', UNPAID_AIRPORT_DEPOSIT_ACCEPT_ERROR)
      if (trip.status === 'scheduled' || trip.scheduled_for || trip.pickup_at) {
        return fail(409, 'scheduled_rpc_required', 'Use scheduled ride acceptance for this trip')
      }
    }
    const transition = resolveDriverTransition({ status: trip.status, op })
    if (transition.error) return fail(409, transition.error, op === 'accept' ? 'That ride is no longer available' : transition.error)
    if (transition.idempotent) {
      if (op === 'accept' && trip.driver_id !== user.id) return fail(409, 'offer_unavailable', 'That ride is no longer available')
      return json(res, 200, { ok: true, trip, idempotent: true })
    }
    if (transition.via === 'wait') {
      const wait = await (deps.applyTripWait || applyTripWait)(sb, { action: op, tripId, actorId: user.id })
      return json(res, 200, { ok: true, trip: wait.trip, wait })
    }
    if (transition.via === 'settle') {
      const payments = await sb.from('payments').select('id, status, kind, amount_cents, metadata').eq('trip_id', tripId)
      if (payments.error) throw payments.error
      const settled = await (deps.settleTrip || settleTrip)({ sb, stripe: (deps.stripeClient || stripeClient)(), trip, payments: payments.data || [], action: 'complete', actor: user })
      if (settled.http !== 200) return json(res, settled.http, { ...settled.body, ok: false, settle: settled.body })
      const fresh = await sb.from('trips').select('*').eq('id', tripId).maybeSingle()
      if (fresh.error) throw fresh.error
      return json(res, 200, { ok: true, trip: fresh.data, settle: settled.body })
    }
    const patch = { status: transition.to }
    let query
    if (op === 'accept') {
      const economics = lockedOfferEconomics(trip)
      if (trip.metadata?.offer_phase === 'expired') return fail(409, 'offer_unavailable', 'That ride is no longer available')
      Object.assign(patch, { driver_id: user.id, accepted_at: new Date().toISOString() })
      if (economics) Object.assign(patch, {
        driver_earnings_cents: economics.netCents,
        platform_fee_cents: economics.platformFeeCents,
        metadata: { ...(trip.metadata || {}), driver_share_bps: economics.shareBps, driver_payout_cents: economics.netCents, accepted_offer_phase: economics.phase },
      })
      query = unchangedOfferQuery(sb.from('trips').update(patch), trip).is('driver_id', null).in('status', ['searching', 'offered'])
    } else {
      query = sb.from('trips').update(patch).eq('driver_id', user.id).eq('status', 'accepted')
    }
    const saved = await query.eq('id', tripId).select('*').maybeSingle()
    if (saved.error) throw saved.error
    if (!saved.data) return fail(409, 'transition_conflict', op === 'accept' ? 'That ride is no longer available' : 'That ride changed. Refresh and try again.')
    const event = await insertTripEvent(sb, { trip_id: tripId, kind: transition.to, payload: { driver_id: user.id, from: trip.status, source: 'trip_status' } })
    if (event.error) return fail(500, 'trip_event_failed', event.error.message)
    return json(res, 200, { ok: true, trip: saved.data })
  } catch (err) {
    const message = err.message || 'Trip update failed'
    const status = err.status || (err.code === '22P02' ? 400
      : /forbidden|approv(?:ed|al)|women.only/i.test(message) ? 403
        : err.code === '55P03' || /not_allowed|invalid_status|unpaid|no longer available|offer changed|go online/i.test(message) ? 409 : 500)
    return fail(status, status === 500 ? 'trip_update_failed' : 'trip_action_rejected', message)
  }
}
