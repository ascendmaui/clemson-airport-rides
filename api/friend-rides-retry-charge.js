/**
 * POST /api/friend-rides-retry-charge
 * Organizer or participant. Retries off_session or returns Payment Element secret.
 */
import {
  admin, cors, json, parseBody, userFromAuth, loadRideByToken, stripeClient, stripeOk,
  ensureStripeCustomer, markParticipantPaid, maybeBookFriendRide, publicRideSummary,
} from '../server/friendRideLib.js'

export default async function handler(req, res) {
  if (cors(req, res)) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
  if (!stripeOk()) {
    return json(res, 503, { error: 'Payments unavailable', message: 'STRIPE_SECRET_KEY not configured' })
  }

  const sb = admin()
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })

  const user = await userFromAuth(req)
  const { body, error: pe } = parseBody(req)
  if (pe) return json(res, 400, { error: pe })

  const { token, participantId } = body
  if (!token || !participantId) return json(res, 400, { error: 'token and participantId required' })

  const stripe = stripeClient()

  try {
    const loaded = await loadRideByToken(sb, token)
    if (!loaded) return json(res, 404, { error: 'Friend ride not found' })
    const { ride, participants } = loaded
    const p = participants.find((x) => x.id === participantId)
    if (!p) return json(res, 404, { error: 'Participant not found' })
    if (p.status === 'paid') return json(res, 200, { status: 'already_paid' })

    const isOrg = user && user.id === ride.organizer_id
    const isSelf = user && p.user_id && user.id === p.user_id
    if (!isOrg && !isSelf) return json(res, 403, { error: 'Not allowed' })

    let profile = null
    if (p.user_id) {
      const { data } = await sb
        .from('profiles')
        .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id')
        .eq('id', p.user_id)
        .maybeSingle()
      profile = data
    }

    if (profile?.stripe_default_pm_id) {
      const customerId = await ensureStripeCustomer(stripe, sb, profile)
      try {
        const pi = await stripe.paymentIntents.create({
          amount: p.fare_cents,
          currency: 'usd',
          customer: customerId,
          payment_method: profile.stripe_default_pm_id,
          off_session: true,
          confirm: true,
          metadata: {
            kind: 'friend_ride_share',
            friend_ride_id: ride.id,
            participant_id: p.id,
            token: ride.token,
          },
        })
        if (pi.status === 'succeeded') {
          const book = await markParticipantPaid(sb, p, pi)
          const reloaded = await loadRideByToken(sb, token)
          return json(res, 200, {
            status: 'paid',
            booked: book.booked,
            trip: book.trip || null,
            ride: publicRideSummary(reloaded.ride, reloaded.participants),
          })
        }
        return json(res, 200, {
          status: pi.status,
          clientSecret: pi.client_secret,
          paymentIntentId: pi.id,
        })
      } catch (err) {
        await sb
          .from('friend_ride_participants')
          .update({
            charge_error: err.message,
            charge_attempts: (p.charge_attempts || 0) + 1,
            updated_at: new Date().toISOString(),
          })
          .eq('id', p.id)
        return json(res, 402, { status: 'failed', error: err.message })
      }
    }

    // Payment Element path
    const piParams = {
      amount: p.fare_cents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: {
        kind: 'friend_ride_share',
        friend_ride_id: ride.id,
        participant_id: p.id,
        token: ride.token,
      },
    }
    if (profile) {
      piParams.customer = await ensureStripeCustomer(stripe, sb, profile)
    }
    const pi = await stripe.paymentIntents.create(piParams)
    await sb
      .from('friend_ride_participants')
      .update({
        stripe_payment_intent_id: pi.id,
        charge_error: 'needs_card',
        charge_attempts: (p.charge_attempts || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', p.id)

    return json(res, 200, {
      status: 'needs_card',
      clientSecret: pi.client_secret,
      paymentIntentId: pi.id,
      fareCents: p.fare_cents,
    })
  } catch (e) {
    return json(res, 500, { error: e.message || 'Server error' })
  }
}
