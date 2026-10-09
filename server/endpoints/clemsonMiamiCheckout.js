/**
 * POST /api/stripe-payment-methods?action=clemson-miami
 * $1 total for one point-to-point ride inside Clemson to the Clemson vs Miami
 * game. Stripe Checkout is required. Client fare, deposit, amount, total,
 * airport, and isStudent are not read. The window is October 3, 2026
 * America/New_York through 7:30 PM, one ride per rider account.
 *
 * Remote driver push is not sent from here. This repo stores Expo push tokens
 * and has no Expo access token or server fan-out. The trip metadata carries
 * the driver copy, and the open driver app schedules that local notification.
 */
import {
  admin, cors, json, parseBody, userFromAuth, stripeClient, stripeOk,
} from '../friendRideLib.js'
import { ensureProfile } from '../ensureProfile.js'
import { feeMetadata, splitPlatformFee } from '../../src/lib/fareRates.js'
import { firstName } from '../../src/lib/scheduledRideModel.js'
import { checkoutSuccessHash } from '../../packages/rides-native/liveTrip.js'
import { rememberCheckoutSession } from '../abandonedCheckout.js'
import { insertTripEvent } from '../tripEvents.js'
import { WEB_ORIGIN } from '../../shared/productLinks.js'
import {
  CLEMSON_MIAMI_DROPOFF,
  CLEMSON_MIAMI_FARE_CENTS,
  CLEMSON_MIAMI_PICKUP,
  CLEMSON_MIAMI_PROMO_ID,
  clemsonMiamiDriverNotification,
  clemsonMiamiPromoOpen,
  isClemsonMiamiPromoRow,
} from '../../packages/rides-native/clemsonMiamiPromo.js'

function clockFrom(deps) {
  if (deps?.now instanceof Date) return deps.now
  if (typeof deps?.now === 'number' || typeof deps?.now === 'string') return new Date(deps.now)
  return new Date()
}

function checkoutOrigin(body) {
  const raw = body && typeof body === 'object' ? body.origin : ''
  if (typeof raw === 'string' && raw) {
    try {
      const url = new URL(raw)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin
    } catch {
      /* fall through to the public site */
    }
  }
  return process.env.VITE_APP_URL || WEB_ORIGIN
}

async function riderAlreadyUsed(sb, riderId) {
  const { data, error } = await sb
    .from('trips')
    .select('id, status, rider_id, metadata')
    .eq('rider_id', riderId)
  if (error) return { error }
  const used = (data || []).some((row) => row?.rider_id === riderId && isClemsonMiamiPromoRow(row))
  return { used }
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (!res.headersSent) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private')
    res.setHeader('Pragma', 'no-cache')
  }
  if (req.method !== 'POST') {
    if (!res.headersSent) res.setHeader('Allow', 'POST, OPTIONS')
    return json(res, 405, { error: 'Method not allowed' })
  }

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const user = deps.user !== undefined ? deps.user : await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const sb = deps.sb || admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const now = clockFrom(deps)
  if (!clemsonMiamiPromoOpen(now)) {
    return json(res, 403, {
      error: 'The $1 Clemson vs Miami ride is only available on October 3, 2026 until 7:30 PM Eastern.',
      chargedCents: null,
      promoApplied: false,
    })
  }

  const isStripeConfigured = deps.stripeOk ? deps.stripeOk() : stripeOk()
  if (!isStripeConfigured) {
    return json(res, 503, {
      error: 'Payments unavailable',
      message: 'STRIPE_SECRET_KEY is not configured. Checkout cannot start.',
      chargedCents: null,
    })
  }

  const prior = await riderAlreadyUsed(sb, user.id)
  if (prior.error) return json(res, 500, { error: prior.error.message || 'Could not check this ride' })
  if (prior.used) {
    return json(res, 409, {
      error: 'This account already used the $1 Clemson vs Miami ride.',
      chargedCents: null,
      promoApplied: false,
    })
  }

  const runEnsureProfile = deps.ensureProfile || ensureProfile
  const profileRes = await runEnsureProfile(sb, user)
  if (!profileRes?.ok) {
    return json(res, 500, { error: 'Could not create your rider profile', code: 'profile_missing' })
  }

  const fareCents = CLEMSON_MIAMI_FARE_CENTS
  const split = splitPlatformFee(fareCents)
  const note = clemsonMiamiDriverNotification(now)
  const riderFirst = firstName(
    user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0],
    'Rider',
  )
  const metadata = {
    kind: 'campus',
    purpose: 'game_day',
    game_day: true,
    promo: CLEMSON_MIAMI_PROMO_ID,
    promo_ride: true,
    airport: null,
    fare_source: 'server',
    rider_first_name: riderFirst,
    student_discount_cents: 0,
    isStudent: false,
    driver_notification: note,
  }
  const row = {
    rider_id: user.id,
    status: 'searching',
    tier: 'standard',
    pickup_label: CLEMSON_MIAMI_PICKUP.label,
    dropoff_label: CLEMSON_MIAMI_DROPOFF.label,
    pickup_lat: CLEMSON_MIAMI_PICKUP.lat,
    pickup_lng: CLEMSON_MIAMI_PICKUP.lng,
    dropoff_lat: CLEMSON_MIAMI_DROPOFF.lat,
    dropoff_lng: CLEMSON_MIAMI_DROPOFF.lng,
    fare_cents: fareCents,
    deposit_cents: fareCents,
    platform_fee_cents: split.platformFeeCents,
    driver_earnings_cents: split.driverEarningsCents,
    surge_multiplier: 1,
    fare_breakdown: {
      fare_source: 'server',
      rider_pays_cents: fareCents,
      promo: CLEMSON_MIAMI_PROMO_ID,
    },
    passengers: 1,
    pickup_at: null,
    scheduled_for: null,
    rider_note: 'clemson_miami',
    metadata,
  }

  const inserted = await sb.from('trips').insert(row).select('id').single()
  if (inserted.error || !inserted.data?.id) {
    return json(res, 500, { error: inserted.error?.message || 'Could not create trip' })
  }
  const tripId = inserted.data.id
  await insertTripEvent(sb, {
    trip_id: tripId,
    kind: 'promo_ride',
    payload: {
      promo: CLEMSON_MIAMI_PROMO_ID,
      fare_cents: fareCents,
      pickup_label: row.pickup_label,
      dropoff_label: row.dropoff_label,
      driver_notification: note,
    },
  })

  try {
    const stripe = deps.stripe || (deps.stripeClient ? deps.stripeClient() : stripeClient())
    const origin = checkoutOrigin(body)
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      success_url: `${origin}/${checkoutSuccessHash({ tripId, scheduled: false })}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#/sign-up?ride=clemson-miami&canceled=1`,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: fareCents,
          product_data: {
            name: 'Clemson RIDES · Clemson Miami game',
            description: 'Point-to-point ride inside Clemson, South Carolina. Fare $1.',
          },
        },
      }],
      metadata: feeMetadata(fareCents, {
        kind: 'promo_ride',
        promo: CLEMSON_MIAMI_PROMO_ID,
        tripId,
        riderId: user.id,
        fareCents,
      }),
    })
    const remembered = await rememberCheckoutSession(sb, tripId, session.id)
    if (!remembered.ok) console.error('[clemson-miami] session bind', remembered.error)
    return json(res, 200, {
      id: session.id,
      url: session.url,
      tripId,
      fareCents,
      chargedCents: fareCents,
      currency: 'usd',
      promoApplied: true,
      airport: null,
      notification: note,
    })
  } catch (err) {
    console.error('[clemson-miami]', err)
    await sb.from('trips').update({
      status: 'canceled',
      canceled_at: new Date().toISOString(),
    }).eq('id', tripId)
    return json(res, 500, {
      error: err.message || 'Stripe error',
      message: 'Stripe Checkout Session create failed',
      tripId,
      chargedCents: null,
    })
  }
}
