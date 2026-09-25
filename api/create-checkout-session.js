/**
 * Vercel serverless — POST /api/create-checkout-session
 * Charges the server airport quote (surge + confirmed Clemson student 10%
 * on Standard). The Stripe line is 25% of that fare. Client fare, deposit,
 * amount, total, and isStudent are ignored.
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk, computeRoutes,
} from '../server/friendRideLib.js'
import { ensureProfile } from '../server/ensureProfile.js'
import { loadGameDayMultiplier } from '../server/creditLots.js'
import { studentDiscountGranted } from '../src/lib/studentDomain.js'
import { feeMetadata, splitPlatformFee, depositSplit, depositSplitLabel } from '../src/lib/fareRates.js'
import { firstName } from '../src/lib/scheduledRideModel.js'
import {
  AIRPORT_DROPOFFS,
  CAMPUS_PICKUP,
  airportTripRow,
  parseRideAt,
  priceCheckoutBody,
} from '../server/authoritativeFare.js'
import { checkoutSuccessHash } from '../packages/rides-native/liveTrip.js'
import { cancelUnopenedCheckoutTrip, rememberCheckoutSession } from '../server/abandonedCheckout.js'
import { WEB_ORIGIN } from '../shared/productLinks.js'

function checkoutOrigin(body) {
  for (const raw of [body.origin, body.successUrl]) {
    if (!raw || typeof raw !== 'string') continue
    try {
      const url = new URL(raw)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin
    } catch {
      /* try the next candidate */
    }
  }
  return process.env.VITE_APP_URL || WEB_ORIGIN
}

async function routeDistance(origin, dest) {
  const route = await computeRoutes(origin, dest, [])
  if (route.error) return { distanceM: null, durationS: null }
  return { distanceM: route.distanceM, durationS: route.durationS }
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const sb = deps.sb || admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const runEnsureProfile = deps.ensureProfile || ensureProfile

  const when = parseRideAt(body, new Date())
  const airport = String(body.airport || 'GSP').toUpperCase() === 'CLT' ? 'CLT' : 'GSP'
  const dest = AIRPORT_DROPOFFS[airport]
  const distance = await routeDistance(CAMPUS_PICKUP, dest)
  let gameDayMultiplier = null
  try {
    const game = await loadGameDayMultiplier(sb, when)
    gameDayMultiplier = game.multiplier
  } catch {
    gameDayMultiplier = null
  }

  const priced = priceCheckoutBody({
    body,
    user,
    at: when,
    gameDayMultiplier,
    distanceM: distance.distanceM,
    durationS: distance.durationS,
  })
  if (priced.isStudent !== studentDiscountGranted(user)) {
    return json(res, 500, { error: 'Student pricing did not match the signed-in email' })
  }

  const quotePayload = {
    airport: priced.airport,
    fareCents: priced.fareCents,
    depositCents: priced.depositCents,
    currency: 'usd',
    studentDiscountApplied: priced.isStudent,
    clientFareIgnored: priced.clientUnderpaid || priced.spoofedStudent,
  }

  const isStripeConfigured = deps.stripeOk ? deps.stripeOk() : stripeOk()
  if (priced.depositCents > 0 && !isStripeConfigured) {
    return json(res, 503, {
      error: 'Payments unavailable',
      message: 'STRIPE_SECRET_KEY is not configured. Checkout cannot start.',
      ...quotePayload,
    })
  }

  const scheduledFor = body.date ? priced.at.toISOString() : null
  const riderFirst = firstName(
    user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0],
    'Rider',
  )
  let tripId = typeof body.tripId === 'string' ? body.tripId : ''

  if (tripId) {
    const existing = await sb.from('trips').select('id, rider_id, metadata').eq('id', tripId).maybeSingle()
    if (existing.error || !existing.data || existing.data.rider_id !== user.id) {
      return json(res, 404, { error: 'Trip not found' })
    }
    const row = airportTripRow({ user, priced, scheduledFor, riderFirst })
    const { error: upErr } = await sb.from('trips').update({
      fare_cents: row.fare_cents,
      deposit_cents: row.deposit_cents,
      platform_fee_cents: row.platform_fee_cents,
      driver_earnings_cents: row.driver_earnings_cents,
      surge_multiplier: row.surge_multiplier,
      fare_breakdown: row.fare_breakdown,
      metadata: { ...(existing.data.metadata || {}), ...row.metadata },
    }).eq('id', tripId).eq('rider_id', user.id)
    if (upErr) return json(res, 500, { error: upErr.message || 'Could not record fare' })
  } else {
    const profileRes = await runEnsureProfile(sb, user)
    if (!profileRes?.ok) {
      return json(res, 500, { error: 'Could not create your rider profile', code: 'profile_missing' })
    }
    const row = airportTripRow({ user, priced, scheduledFor, riderFirst })
    const inserted = await sb.from('trips').insert(row).select('id').single()
    if (inserted.error || !inserted.data) {
      return json(res, 500, { error: inserted.error?.message || 'Could not create trip' })
    }
    tripId = inserted.data.id
  }

  if (priced.depositCents <= 0) {
    return json(res, 200, { ...quotePayload, tripId, paidWithCredits: false })
  }

  try {
    const stripe = deps.stripe || (deps.stripeClient ? deps.stripeClient() : stripeClient())
    const origin = checkoutOrigin(body)
    const split = depositSplit(priced.fareCents, priced.depositCents)
    const fareSplit = splitPlatformFee(priced.fareCents)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${origin}/${checkoutSuccessHash({ tripId, scheduled: Boolean(scheduledFor) })}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#/schedule?canceled=1&trip=${tripId}`,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: priced.unitAmount,
          product_data: {
            name: `Clemson RIDES ${priced.airport} deposit (25%)`,
            description: depositSplitLabel(split),
          },
        },
      }],
      metadata: feeMetadata(priced.depositCents, {
        airport: priced.airport,
        fareCents: priced.fareCents,
        depositCents: priced.depositCents,
        riderName: riderFirst,
        kind: 'airport_deposit',
        tripId,
        riderId: user.id,
        fare_platform_fee_cents: fareSplit.platformFeeCents,
        fare_driver_earnings_cents: fareSplit.driverEarningsCents,
      }),
    })
    const remembered = await rememberCheckoutSession(sb, tripId, session.id)
    if (!remembered.ok) console.error('[create-checkout-session] session bind', remembered.error)
    return json(res, 200, {
      id: session.id,
      url: session.url,
      tripId,
      ...quotePayload,
    })
  } catch (err) {
    console.error('[create-checkout-session]', err)
    await cancelUnopenedCheckoutTrip(sb, tripId, {
      reason: 'checkout_create_failed',
      source: 'create_checkout_session',
    })
    return json(res, 500, {
      error: err.message || 'Stripe error',
      message: 'Stripe Checkout Session create failed',
      tripId,
      ...quotePayload,
    })
  }
}
