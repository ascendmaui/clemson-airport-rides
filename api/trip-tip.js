/**
 * POST /api/trip-tip
 * Rider tip after a completed trip.
 * Saved card → off-session PaymentIntent (same pattern as friend-ride shares).
 * Otherwise → PaymentIntent client_secret for confirmPayment on the post-ride screen.
 * mode: charge | finalize
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk, ensureStripeCustomer,
} from '../server/friendRideLib.js'

const MIN_TIP = 100
const MAX_TIP = 10000

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  if (!stripeOk()) {
    return json(res, 503, {
      error: 'Payments unavailable',
      message: 'STRIPE_SECRET_KEY is not configured. Tips cannot be charged.',
    })
  }
  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const mode = body.mode === 'finalize' ? 'finalize' : 'charge'
  try {
    if (mode === 'finalize') return await finalize(res, sb, user, body)
    return await charge(res, sb, user, body)
  } catch (err) {
    console.error('[trip-tip]', err)
    return json(res, 500, { error: err.message || 'Tip failed' })
  }
}

async function loadOwnedTrip(sb, userId, tripId) {
  if (!tripId) {
    const err = new Error('tripId required')
    err.status = 400
    throw err
  }
  const { data: trip, error } = await sb
    .from('trips')
    .select('id, rider_id, driver_id, status, fare_cents, tip_cents')
    .eq('id', tripId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!trip || trip.rider_id !== userId) {
    const err = new Error('Trip not found')
    err.status = 404
    throw err
  }
  if (trip.status !== 'completed') {
    const err = new Error('You can tip once the trip is completed')
    err.status = 409
    throw err
  }
  return trip
}

function tipAmount(body) {
  const cents = Math.round(Number(body.tipCents))
  if (!Number.isFinite(cents) || cents < MIN_TIP || cents > MAX_TIP) {
    const err = new Error('Tip must be between $1 and $100')
    err.status = 400
    throw err
  }
  return cents
}

async function charge(res, sb, user, body) {
  const trip = await loadOwnedTrip(sb, user.id, body.tripId)
  if (Number(trip.tip_cents) > 0) {
    return json(res, 409, { error: 'Tip already added', tipCents: trip.tip_cents })
  }
  const cents = tipAmount(body)
  const stripe = stripeClient()

  const { data: profile } = await sb
    .from('profiles')
    .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id')
    .eq('id', user.id)
    .maybeSingle()

  const customerId = profile ? await ensureStripeCustomer(stripe, sb, profile) : null
  const metadata = {
    kind: 'tip',
    tripId: trip.id,
    riderId: user.id,
    driverId: trip.driver_id || '',
    tipCents: String(cents),
  }

  if (profile?.stripe_default_pm_id && customerId) {
    const pi = await stripe.paymentIntents.create({
      amount: cents,
      currency: 'usd',
      customer: customerId,
      payment_method: profile.stripe_default_pm_id,
      off_session: true,
      confirm: true,
      description: `Clemson RIDES tip · trip ${trip.id}`,
      metadata,
    })
    if (pi.status === 'succeeded') {
      await writeTip(sb, { tripId: trip.id, riderId: user.id, amount: cents, piId: pi.id })
      return json(res, 200, { ok: true, tipCents: cents, paymentIntentId: pi.id })
    }
    return json(res, 200, {
      ok: false,
      requiresAction: true,
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      tipCents: cents,
    })
  }

  const pi = await stripe.paymentIntents.create({
    amount: cents,
    currency: 'usd',
    customer: customerId || undefined,
    automatic_payment_methods: { enabled: true },
    description: `Clemson RIDES tip · trip ${trip.id}`,
    metadata,
  })
  return json(res, 200, {
    ok: false,
    needsPaymentMethod: true,
    clientSecret: pi.client_secret,
    paymentIntentId: pi.id,
    tipCents: cents,
  })
}

async function finalize(res, sb, user, body) {
  const trip = await loadOwnedTrip(sb, user.id, body.tripId)
  const piId = body.paymentIntentId
  if (!piId) return json(res, 400, { error: 'paymentIntentId required' })
  const stripe = stripeClient()
  const pi = await stripe.paymentIntents.retrieve(piId)
  if (pi.metadata?.kind !== 'tip' || pi.metadata?.tripId !== trip.id || pi.metadata?.riderId !== user.id) {
    return json(res, 403, { error: 'Payment does not match this trip' })
  }
  if (pi.status !== 'succeeded') {
    return json(res, 409, { error: `Payment status ${pi.status}` })
  }
  const amount = Number(pi.amount) || 0
  await writeTip(sb, { tripId: trip.id, riderId: user.id, amount, piId: pi.id })
  return json(res, 200, { ok: true, tipCents: amount, paymentIntentId: pi.id })
}

async function writeTip(sb, { tripId, riderId, amount, piId }) {
  const { data: existing } = await sb
    .from('payments')
    .select('id')
    .eq('stripe_payment_intent_id', piId)
    .maybeSingle()
  if (!existing) {
    const { error } = await sb.from('payments').insert({
      trip_id: tripId,
      rider_id: riderId,
      stripe_payment_intent_id: piId,
      kind: 'tip',
      amount_cents: amount,
      status: 'succeeded',
    })
    if (error && !/duplicate|unique/i.test(error.message || '')) throw new Error(error.message)
  }
  const { error: upErr } = await sb
    .from('trips')
    .update({ tip_cents: amount })
    .eq('id', tripId)
    .eq('rider_id', riderId)
  if (upErr) throw new Error(upErr.message)
}
