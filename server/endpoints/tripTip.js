/**
 * POST /api/trip-tip
 * Rider tip after a completed trip. Same Stripe client as the 25% deposit.
 * Saved card → off-session PaymentIntent (same pattern as friend-ride shares).
 * Otherwise → PaymentIntent client_secret. The caller does not confirm a card here.
 * tipPercent is 15, 20, or 25 of the stored fare. tipCents is a custom amount.
 * mode: charge | finalize
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk, ensureStripeCustomer,
} from '../friendRideLib.js'
import {
  customTipCents,
  isTipPercent,
  knownFareCents,
  tipCentsForPercent,
} from '../../packages/rides-native/tipPresets.js'
import { tipChargeResponse, tipCreditRecord } from '../tipCredit.js'

const MIN_TIP = 100
const MAX_TIP = 10000

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  const ready = deps.stripeOk ? deps.stripeOk() : stripeOk()
  if (!ready) {
    return json(res, 503, {
      error: 'Payments unavailable',
      message: 'STRIPE_SECRET_KEY is not configured. Tips cannot be charged.',
    })
  }
  const sb = deps.admin ? deps.admin() : admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.userFromAuth ? await deps.userFromAuth(req) : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const stripe = deps.stripe || (deps.stripeClient ? deps.stripeClient() : stripeClient())
  if (!stripe) {
    return json(res, 503, { error: 'Payments unavailable', message: 'Stripe client is not configured.' })
  }

  const mode = body.mode === 'finalize' ? 'finalize' : 'charge'
  try {
    if (mode === 'finalize') return await finalize(res, sb, user, body, stripe)
    return await charge(res, sb, user, body, stripe)
  } catch (err) {
    const status = err.status || 500
    if (status >= 500) console.error('[trip-tip]', err)
    return json(res, status, { error: err.message || 'Tip failed' })
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
    .select('id, rider_id, driver_id, status, fare_cents, tip_cents, metadata')
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
  if (!trip.driver_id) {
    const err = new Error('This ride has no driver to tip')
    err.status = 409
    throw err
  }
  return trip
}

function tipAmount(body) {
  const parsed = customTipCents(Number.isFinite(Number(body.tipCents))
    ? (Math.round(Number(body.tipCents)) / 100).toFixed(2)
    : body.tipCents)
  if (parsed.error) {
    const err = new Error(parsed.error === 'Enter a tip amount' || parsed.error === 'Enter a dollar amount'
      ? 'Tip must be between $1 and $100'
      : parsed.error)
    err.status = 400
    throw err
  }
  return parsed.cents
}

function resolveTip(trip, body) {
  const hasPercent = body.tipPercent != null && body.tipPercent !== ''
  if (hasPercent) {
    const percent = Number(body.tipPercent)
    if (!isTipPercent(percent)) {
      const err = new Error('Tip percent must be 15, 20, or 25')
      err.status = 400
      throw err
    }
    const fare = knownFareCents(trip.fare_cents)
    if (fare == null) {
      const err = new Error('Fare is not on this ride yet, so a percent tip cannot be charged')
      err.status = 409
      throw err
    }
    const cents = tipCentsForPercent(fare, percent)
    if (cents == null || cents < MIN_TIP || cents > MAX_TIP) {
      const err = new Error('Tip must be between $1 and $100')
      err.status = 400
      throw err
    }
    return { cents, percent, fareCents: fare }
  }
  return { cents: tipAmount(body), percent: null, fareCents: knownFareCents(trip.fare_cents) }
}

async function charge(res, sb, user, body, stripe) {
  const trip = await loadOwnedTrip(sb, user.id, body.tripId)
  if (Number(trip.tip_cents) > 0) {
    return json(res, 409, { error: 'Tip already added', tipCents: trip.tip_cents })
  }
  const priced = resolveTip(trip, body)
  const cents = priced.cents

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
    tipPercent: priced.percent == null ? '' : String(priced.percent),
    fareCents: priced.fareCents == null ? '' : String(priced.fareCents),
  }
  const idempotencyKey = `tip:${trip.id}:${cents}`

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
    }, { idempotencyKey })
    if (pi.status === 'succeeded') {
      const credit = await writeTip(sb, {
        trip,
        riderId: user.id,
        amount: cents,
        piId: pi.id,
        tipPercent: priced.percent,
      })
      return json(res, 200, tipChargeResponse(credit, {
        ok: true,
        tipCents: cents,
        tipPercent: priced.percent,
        fareCents: priced.fareCents,
        paymentIntentId: pi.id,
      }))
    }
    return json(res, 200, {
      ok: false,
      requiresAction: true,
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      tipCents: cents,
      tipPercent: priced.percent,
    })
  }

  const pi = await stripe.paymentIntents.create({
    amount: cents,
    currency: 'usd',
    customer: customerId || undefined,
    automatic_payment_methods: { enabled: true },
    description: `Clemson RIDES tip · trip ${trip.id}`,
    metadata,
  }, { idempotencyKey })
  return json(res, 200, {
    ok: false,
    needsPaymentMethod: true,
    clientSecret: pi.client_secret,
    paymentIntentId: pi.id,
    tipCents: cents,
    tipPercent: priced.percent,
  })
}

async function finalize(res, sb, user, body, stripe) {
  const trip = await loadOwnedTrip(sb, user.id, body.tripId)
  const piId = body.paymentIntentId
  if (!piId) return json(res, 400, { error: 'paymentIntentId required' })
  const pi = await stripe.paymentIntents.retrieve(piId)
  if (pi.metadata?.kind !== 'tip' || pi.metadata?.tripId !== trip.id || pi.metadata?.riderId !== user.id) {
    return json(res, 403, { error: 'Payment does not match this trip' })
  }
  if (pi.status !== 'succeeded') {
    return json(res, 409, { error: `Payment status ${pi.status}` })
  }
  const amount = Number(pi.amount) || 0
  const percent = pi.metadata?.tipPercent ? Number(pi.metadata.tipPercent) : null
  const credit = await writeTip(sb, {
    trip,
    riderId: user.id,
    amount,
    piId: pi.id,
    tipPercent: Number.isFinite(percent) ? percent : null,
  })
  return json(res, 200, tipChargeResponse(credit, {
    ok: true,
    tipCents: amount,
    tipPercent: Number.isFinite(percent) ? percent : null,
    paymentIntentId: pi.id,
  }))
}

async function writeTip(sb, { trip, riderId, amount, piId, tipPercent }) {
  const credit = tipCreditRecord({
    driverId: trip.driver_id,
    amountCents: amount,
    paymentIntentId: piId,
    tipPercent,
  })
  const { data: existing } = await sb
    .from('payments')
    .select('id')
    .eq('stripe_payment_intent_id', piId)
    .maybeSingle()
  if (!existing) {
    const rich = {
      trip_id: trip.id,
      rider_id: riderId,
      stripe_payment_intent_id: piId,
      kind: 'tip',
      amount_cents: amount,
      status: 'succeeded',
      platform_fee_cents: credit.split.platformFeeCents,
      driver_earnings_cents: credit.split.driverEarningsCents,
      metadata: {
        logical_kind: 'tip',
        driver_id: trip.driver_id,
        tip_percent: tipPercent,
        tip_owed: credit.owed,
      },
    }
    let inserted = await sb.from('payments').insert(rich)
    if (inserted.error && /platform_fee_cents|driver_earnings_cents|metadata|column|schema cache/i.test(inserted.error.message || '')) {
      inserted = await sb.from('payments').insert({
        trip_id: trip.id,
        rider_id: riderId,
        stripe_payment_intent_id: piId,
        kind: 'tip',
        amount_cents: amount,
        status: 'succeeded',
      })
    }
    if (inserted.error && !/duplicate|unique/i.test(inserted.error.message || '')) {
      throw new Error(inserted.error.message)
    }
  }
  const metadata = {
    ...(trip.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}),
    tip_cents: amount,
    tip_owed: credit.owed,
  }
  let updated = await sb.from('trips').update({ tip_cents: amount, metadata }).eq('id', trip.id).eq('rider_id', riderId)
  if (updated.error && /metadata|column|schema cache/i.test(updated.error.message || '')) {
    updated = await sb.from('trips').update({ tip_cents: amount }).eq('id', trip.id).eq('rider_id', riderId)
  }
  if (updated.error) throw new Error(updated.error.message)
  return credit
}
