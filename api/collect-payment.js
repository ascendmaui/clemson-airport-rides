/**
 * POST /api/collect-payment
 * Body: { tripId, amountCents, kind, methods, paymentMethodId, idempotencyKey, midRide }
 * kinds: balance | tip | wait_fee | cancel_fee | mid_ride | friend_ride_share | credits_purchase
 * Wait/cancel amounts must already be computed by their owners.
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk,
} from '../server/friendRideLib.js'
import { collectPayment } from '../server/collectPayment.js'

const KINDS = new Set(['balance', 'tip', 'wait_fee', 'cancel_fee', 'mid_ride', 'friend_ride_share', 'deposit', 'credits_purchase'])

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const kind = body.kind || 'balance'
  if (!KINDS.has(kind)) return json(res, 400, { error: 'Unsupported payment kind' })
  if (body.amountCents == null) return json(res, 400, { error: 'amountCents required' })

  const amountCents = Math.round(Number(body.amountCents))
  if (!Number.isFinite(amountCents) || amountCents < 0) {
    return json(res, 400, { error: 'amountCents must be a non-negative number' })
  }

  if (amountCents > 0 && !stripeOk()) {
    return json(res, 503, { error: 'Payments unavailable', message: 'STRIPE_SECRET_KEY not configured' })
  }

  let trip = null
  if (body.tripId) {
    const loaded = await sb.from('trips').select('id, rider_id, driver_id, status, fare_cents, metadata').eq('id', body.tripId).maybeSingle()
    if (loaded.error || !loaded.data) return json(res, 404, { error: 'Trip not found' })
    trip = loaded.data
    if (trip.rider_id !== user.id && trip.driver_id !== user.id) {
      return json(res, 403, { error: 'Not allowed on this trip' })
    }
  }

  const riderId = trip?.rider_id || user.id
  try {
    const result = await collectPayment({
      sb,
      stripe: stripeClient(),
      tripId: trip?.id || null,
      riderId,
      amountCents,
      kind,
      methods: body.methods,
      paymentMethodId: body.paymentMethodId || null,
      idempotencyKey: body.idempotencyKey || (trip ? `${trip.id}:${kind}:${amountCents}` : null),
      midRide: Boolean(body.midRide) || ['accepted', 'arriving', 'in_progress'].includes(trip?.status),
      hold: Boolean(trip?.id),
      metadata: { source: 'collect-payment' },
    })
    if (!result.ok) {
      return json(res, 402, { error: result.message, failure: result, status: 'payment_required' })
    }
    return json(res, 200, result)
  } catch (err) {
    console.error('[collect-payment]', err)
    return json(res, 500, { error: err.message || 'Server error' })
  }
}
