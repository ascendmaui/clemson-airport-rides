/**
 * POST /api/friend-rides-confirm-charges
 * Organizer only. Off-session PI for saved cards; Payment Element client_secrets for others.
 * Full share (not 25% deposit). Books trip only when all paid.
 */
import {
  admin, cors, json, parseBody, userFromAuth, loadRideByToken, stripeClient, stripeOk,
  maybeBookFriendRide, publicRideSummary,
} from '../server/friendRideLib.js'
import { recomputeRideFares } from '../server/friendRideRecompute.js'
import { chargeFriendShare } from '../server/chargeShare.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  if (!stripeOk()) {
    return json(res, 503, {
      error: 'Payments unavailable',
      message: 'STRIPE_SECRET_KEY is not configured. Cannot charge friend rides.',
    })
  }

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  if (!user) return json(res, 401, { error: 'Sign in required' })

  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })
  const token = body.token
  if (!token) return json(res, 400, { error: 'token required' })

  const stripe = stripeClient()
  const origin =
    body.origin ||
    process.env.VITE_APP_URL ||
    'https://clemson-airport-rides.vercel.app'

  try {
    const loaded = await loadRideByToken(sb, token)
    if (!loaded) return json(res, 404, { error: 'Friend ride not found' })
    let { ride, participants } = loaded
    if (ride.organizer_id !== user.id) return json(res, 403, { error: 'Organizer only' })
    if (ride.trip_id) return json(res, 409, { error: 'Already booked', trip_id: ride.trip_id })

    // Always refresh fares from live route + vehicle + party size before charge.
    const recomputed = await recomputeRideFares(sb, token, { splitMode: ride.split_mode })
    if (!recomputed.ok) {
      return json(res, 400, {
        error: recomputed.message || recomputed.error || 'Could not calculate fares',
        code: recomputed.code || 'recompute_failed',
        message: recomputed.message || recomputed.error,
      })
    }
    ride = recomputed.ride
    participants = recomputed.participants
    if (!ride.total_fare_cents || !participants.every((p) => p.fare_cents != null)) {
      return json(res, 400, {
        error: 'Could not calculate fares for this ride. Check pickups/dropoffs and try again.',
        code: 'fares_missing',
      })
    }

    await sb
      .from('friend_rides')
      .update({ status: 'awaiting_payment', updated_at: new Date().toISOString() })
      .eq('id', ride.id)

    const results = []
    const paymentElementSecrets = []
    const useCredits = body.useCredits !== false

    for (const p of participants) {
      const charged = await chargeFriendShare(sb, stripe, {
        ride,
        participant: p,
        actingUserId: user.id,
        useCredits,
      })
      results.push(charged.result)
      if (charged.secret) paymentElementSecrets.push(charged.secret)
    }

    const book = await maybeBookFriendRide(sb, ride.id)
    const reloaded = await loadRideByToken(sb, token)

    return json(res, 200, {
      results,
      paymentElementSecrets,
      booked: book.booked,
      trip: book.trip || null,
      bookReason: book.reason || null,
      ride: publicRideSummary(reloaded.ride, reloaded.participants),
      returnUrl: `${origin}/${(reloaded.ride.kind === 'carpool' ? 'carpool' : 'friends')}/${token}?charged=1`,
      note: 'Apple Pay requires the domain to be registered in Stripe Dashboard -> Payment method domains.',
    })
  } catch (e) {
    console.error('[confirm-charges]', e)
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
