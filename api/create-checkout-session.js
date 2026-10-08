/**
 * Vercel serverless — POST /api/create-checkout-session
 * Books the server airport quote (surge + confirmed Clemson student 10%
 * on Standard). No deposit Checkout session. The full fare is charged when
 * the trip ends. Client fare, deposit, amount, total, and isStudent are ignored.
 */
import {
  admin, cors, json, parseBody, userFromAuth, computeRoutes,
} from '../server/friendRideLib.js'
import { ensureProfile } from '../server/ensureProfile.js'
import { loadGameDayMultiplier } from '../server/creditLots.js'
import { studentDiscountGranted } from '../src/lib/studentDomain.js'
import { splitPlatformFee } from '../src/lib/fareRates.js'
import { firstName } from '../src/lib/scheduledRideModel.js'
import {
  AIRPORT_DROPOFFS,
  CAMPUS_PICKUP,
  airportTripRow,
  parseRideAt,
  priceCheckoutBody,
} from '../server/authoritativeFare.js'
import { tigerPassBpsForRider } from '../server/riderPass.js'

async function routeDistance(origin, dest) {
  const route = await computeRoutes(origin, dest, [])
  if (route.error) return { distanceM: null, durationS: null }
  return { distanceM: route.distanceM, durationS: route.durationS }
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

  let priced
  try {
    const tigerPassBps = await tigerPassBpsForRider(sb, user.id, when)
    priced = priceCheckoutBody({
      body,
      user,
      at: when,
      gameDayMultiplier,
      distanceM: distance.distanceM,
      durationS: distance.durationS,
      tigerPassBps,
    })
  } catch (error) {
    return json(res, error.status || 400, {
      error: error.message || 'That ride option is not offered.',
      code: error.code || 'ride_option_unavailable',
    })
  }
  const expectedStudent = studentDiscountGranted(user) && priced.tier === 'standard'
  if (priced.isStudent !== expectedStudent) {
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

  const fareSplit = splitPlatformFee(priced.fareCents)
  return json(res, 200, {
    ...quotePayload,
    depositCents: 0,
    tripId,
    paidWithCredits: false,
    charged: false,
    dueAtTripEndCents: priced.fareCents,
    platformFeeCents: fareSplit.platformFeeCents,
    driverEarningsCents: fareSplit.driverEarningsCents,
  })
}
