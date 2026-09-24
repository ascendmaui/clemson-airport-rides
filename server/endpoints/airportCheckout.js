/**
 * POST /api/airport-checkout
 * Quotes the metered airport fare (surge + student), optionally spends ride
 * credits, and opens Stripe Checkout for the card deposit (25% of the cash
 * remainder). A fully credit-funded fare does not open Checkout.
 * Platform 20% is stored on the trip (full rider price) and on each captured
 * charge (deposit cash, and credit redemption when checkout completes).
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk,
  ensureStripeCustomer, computeRoutes,
} from '../friendRideLib.js'
import {
  loadGameDayMultiplier, planSettlement, debitLots, insertChargePayment,
} from '../creditLots.js'
import { studentDiscountGranted } from '../../src/lib/studentDomain.js'
import { quoteAirportCheckout } from '../authoritativeFare.js'
import {
  splitPlatformFee,
  feeMetadata,
  cardDepositCents,
  depositSplit,
  depositSplitLabel,
} from '../../src/lib/fareRates.js'
import { checkoutSuccessHash } from '../../packages/rides-native/liveTrip.js'

const CAMPUS = { label: 'Memorial Stadium', lat: 34.6788, lng: -82.843 }
const AIRPORTS = {
  GSP: { label: 'Greenville-Spartanburg International (GSP)', lat: 34.8956, lng: -82.2189 },
  CLT: { label: 'Charlotte Douglas International (CLT)', lat: 35.2144, lng: -80.9473 },
}

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const airport = String(body.airport || 'GSP').toUpperCase()
  const dest = AIRPORTS[airport]
  if (!dest) return json(res, 400, { error: 'Unknown airport' })

  let scheduledFor = null
  let at = new Date()
  if (body.date) {
    const hhmm = body.time || '12:00'
    const parsed = new Date(`${body.date}T${hhmm}:00`)
    if (!Number.isNaN(parsed.getTime())) {
      scheduledFor = parsed.toISOString()
      at = parsed
    }
  }

  const { data: profile } = await sb
    .from('profiles')
    .select('id, email, full_name, stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()
  const isStudent = studentDiscountGranted(user)

  let distanceM = null
  let durationS = null
  let routeSource = 'fallback'
  const route = await computeRoutes(CAMPUS, dest, [])
  if (!route.error) {
    distanceM = route.distanceM
    durationS = route.durationS
    routeSource = 'google'
  }
  const game = await loadGameDayMultiplier(sb, at)
  const priced = quoteAirportCheckout({
    airport,
    at,
    isStudent,
    gameDayMultiplier: game.multiplier,
    distanceM,
    durationS,
  })
  const quoted = priced.quote
  const surge = priced.surge

  const useCredits = body.useCredits !== false
  const settlement = await planSettlement(sb, {
    profileId: user.id,
    fareCents: quoted.fareBeforeCreditsCents,
    useCredits,
  })
  const fareSplit = splitPlatformFee(settlement.riderPaysCents)
  const depositCents = cardDepositCents(settlement.cashCents)
  const split = depositSplit(settlement.riderPaysCents, depositCents)

  if (depositCents > 0 && !stripeOk()) {
    return json(res, 503, {
      error: 'Payments unavailable',
      message: 'STRIPE_SECRET_KEY is not configured. Checkout cannot start.',
      fareCents: settlement.riderPaysCents,
      depositCents,
      remainingCents: split.remainingCents,
    })
  }

  const { data: trip, error: tripErr } = await sb
    .from('trips')
    .insert({
      rider_id: user.id,
      status: scheduledFor ? 'scheduled' : 'searching',
      tier: 'standard',
      pickup_label: CAMPUS.label,
      dropoff_label: dest.label,
      pickup_lat: CAMPUS.lat,
      pickup_lng: CAMPUS.lng,
      dropoff_lat: dest.lat,
      dropoff_lng: dest.lng,
      fare_cents: settlement.riderPaysCents,
      deposit_cents: depositCents,
      platform_fee_cents: fareSplit.platformFeeCents,
      driver_earnings_cents: fareSplit.driverEarningsCents,
      surge_multiplier: surge.multiplier,
      fare_breakdown: {
        ...quoted.breakdown,
        route_source: routeSource,
        surge_rule: surge.rule?.id || null,
        surge_label: surge.rule?.label || null,
        credits_debited_cents: settlement.creditsDebitedCents,
        credit_discount_cents: settlement.creditDiscountCents,
        cash_cents: settlement.cashCents,
        rider_pays_cents: settlement.riderPaysCents,
      },
      passengers: 1,
      pickup_at: scheduledFor,
      scheduled_for: scheduledFor,
      metadata: {
        kind: scheduledFor ? 'scheduled' : 'airport',
        airport,
        pending_credit_debits: depositCents > 0 ? settlement.debits : [],
        credits_applied: false,
      },
    })
    .select('id')
    .single()
  if (tripErr) return json(res, 500, { error: tripErr.message || 'Could not create trip' })

  if (depositCents <= 0) {
    if (settlement.creditsDebitedCents > 0) {
      try {
        await debitLots(sb, {
          profileId: user.id,
          debits: settlement.debits,
          note: `airport:${trip.id}`,
          tripId: trip.id,
        })
        await insertChargePayment(sb, {
          riderId: user.id,
          tripId: trip.id,
          kind: 'ride_fare',
          amountCents: settlement.creditsDebitedCents,
          metadata: { method: 'credits', airport, discount_cents: settlement.creditDiscountCents },
        })
      } catch (err) {
        await sb.from('trips').update({ status: 'canceled', canceled_at: new Date().toISOString() }).eq('id', trip.id)
        return json(res, 409, { error: err.message || 'Could not spend credits' })
      }
    }
    await sb.from('trips').update({
      metadata: {
        kind: scheduledFor ? 'scheduled' : 'airport',
        airport,
        pending_credit_debits: [],
        credits_applied: true,
      },
    }).eq('id', trip.id)
    return json(res, 200, {
      paidWithCredits: true,
      tripId: trip.id,
      fareCents: settlement.riderPaysCents,
      depositCents: 0,
      studentDiscountApplied: isStudent,
      surge,
      routeSource,
    })
  }

  try {
    const stripe = stripeClient()
    let customerId = null
    if (profile) {
      try { customerId = await ensureStripeCustomer(stripe, sb, profile) } catch { /* guest checkout */ }
    }
    const origin = body.origin || process.env.VITE_APP_URL || 'https://clemson-airport-rides.vercel.app'
    const depositFee = splitPlatformFee(depositCents)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId || undefined,
      success_url: `${origin}/${checkoutSuccessHash({ tripId: trip.id, scheduled: Boolean(scheduledFor) })}`,
      cancel_url: `${origin}/#/schedule?canceled=1&trip=${trip.id}`,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: depositCents,
          product_data: {
            name: `Clemson RIDES ${airport} deposit (25%)`,
            description: depositSplitLabel(split),
          },
        },
      }],
      metadata: {
        ...feeMetadata(depositCents, {
          kind: 'airport_deposit',
          airport,
          tripId: trip.id,
          riderId: user.id,
          fareCents: settlement.riderPaysCents,
          depositCents,
        }),
        fare_platform_fee_cents: String(fareSplit.platformFeeCents),
        fare_driver_earnings_cents: String(fareSplit.driverEarningsCents),
      },
    })
    return json(res, 200, {
      id: session.id,
      url: session.url,
      tripId: trip.id,
      airport,
      fareCents: settlement.riderPaysCents,
      depositCents,
      studentDiscountApplied: isStudent,
      platformFeeCents: depositFee.platformFeeCents,
      driverEarningsCents: depositFee.driverEarningsCents,
      surge,
      routeSource,
      currency: 'usd',
    })
  } catch (err) {
    console.error('[airport-checkout]', err)
    return json(res, 500, { error: err.message || 'Stripe error', tripId: trip.id })
  }
}
