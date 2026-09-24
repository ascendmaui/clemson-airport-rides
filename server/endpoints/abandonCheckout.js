/**
 * POST /api/stripe-payment-methods?action=abandon-checkout
 * Rider return from a canceled Checkout, or the app after the browser closes
 * with no deposit. Expires a still-open session, then cancels the unpaid
 * searching/scheduled trip. A paid session is left in the live match pool.
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk,
} from '../friendRideLib.js'
import { releaseUnpaidCheckoutTrip } from '../abandonedCheckout.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const tripId = body.tripId || body.trip_id
  if (!tripId || typeof tripId !== 'string') return json(res, 400, { error: 'tripId required' })

  const { data: trip, error } = await sb
    .from('trips')
    .select('id, rider_id, metadata, status')
    .eq('id', tripId)
    .maybeSingle()
  if (error || !trip || trip.rider_id !== user.id) return json(res, 404, { error: 'Trip not found' })

  const sessionId = body.sessionId || body.session_id || trip.metadata?.stripe_checkout_session_id
  if (!sessionId || typeof sessionId !== 'string') {
    return json(res, 409, { error: 'Checkout session not found', reason: 'missing_session' })
  }
  if (!stripeOk()) return json(res, 503, { error: 'Payments unavailable' })

  try {
    const stripe = stripeClient()
    const session = await stripe.checkout.sessions.retrieve(sessionId)
    if (String(session?.metadata?.tripId || '') !== tripId) {
      return json(res, 403, { error: 'Session does not match this trip' })
    }
    if (session?.metadata?.riderId && String(session.metadata.riderId) !== user.id) {
      return json(res, 403, { error: 'Not your checkout' })
    }
    const result = await releaseUnpaidCheckoutTrip(sb, session, {
      reason: 'checkout_canceled',
      source: 'checkout_return',
      expireSession: (id) => stripe.checkout.sessions.expire(id),
      retrieveSession: (id) => stripe.checkout.sessions.retrieve(id),
    })
    return json(res, 200, { ok: true, ...result })
  } catch (err) {
    return json(res, 500, { error: err.message || 'Could not close checkout' })
  }
}
