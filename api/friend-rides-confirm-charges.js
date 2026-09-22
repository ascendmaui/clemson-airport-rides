/**
 * POST /api/friend-rides-confirm-charges
 * Organizer only. Off-session PI for saved cards; Payment Element client_secrets for others.
 * Full share (not 25% deposit). Books trip only when all paid.
 */
import {
  admin, cors, json, parseBody, userFromAuth, loadRideByToken, stripeClient, stripeOk,
  ensureStripeCustomer, markParticipantPaid, maybeBookFriendRide, publicRideSummary,
} from '../server/friendRideLib.js'

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
    const { ride, participants } = loaded
    if (ride.organizer_id !== user.id) return json(res, 403, { error: 'Organizer only' })
    if (ride.trip_id) return json(res, 409, { error: 'Already booked', trip_id: ride.trip_id })

    if (!ride.total_fare_cents || !participants.every((p) => p.fare_cents != null)) {
      return json(res, 400, { error: 'Recompute route/fares before charging' })
    }

    await sb
      .from('friend_rides')
      .update({ status: 'awaiting_payment', updated_at: new Date().toISOString() })
      .eq('id', ride.id)

    const results = []
    const paymentElementSecrets = []

    for (const p of participants) {
      if (p.status === 'paid') {
        results.push({ participantId: p.id, status: 'already_paid' })
        continue
      }
      if (!p.fare_cents || p.fare_cents <= 0) {
        results.push({ participantId: p.id, status: 'skipped', error: 'No fare' })
        continue
      }

      // Need linked profile with card for off_session
      let profile = null
      if (p.user_id) {
        const { data } = await sb
          .from('profiles')
          .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id')
          .eq('id', p.user_id)
          .maybeSingle()
        profile = data
      }

      if (profile?.stripe_default_pm_id && profile?.stripe_customer_id) {
        try {
          await sb
            .from('friend_ride_participants')
            .update({
              charge_attempts: (p.charge_attempts || 0) + 1,
              charge_error: null,
              updated_at: new Date().toISOString(),
            })
            .eq('id', p.id)

          const pi = await stripe.paymentIntents.create({
            amount: p.fare_cents,
            currency: 'usd',
            customer: profile.stripe_customer_id,
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
            await markParticipantPaid(sb, p, pi)
            results.push({ participantId: p.id, status: 'paid', paymentIntentId: pi.id })
          } else if (pi.status === 'requires_action') {
            paymentElementSecrets.push({
              participantId: p.id,
              clientSecret: pi.client_secret,
              reason: 'requires_action',
            })
            await sb
              .from('friend_ride_participants')
              .update({
                stripe_payment_intent_id: pi.id,
                charge_error: 'requires_authentication',
                updated_at: new Date().toISOString(),
              })
              .eq('id', p.id)
            results.push({ participantId: p.id, status: 'requires_action', paymentIntentId: pi.id })
          } else {
            await sb
              .from('friend_ride_participants')
              .update({
                stripe_payment_intent_id: pi.id,
                charge_error: `status:${pi.status}`,
                updated_at: new Date().toISOString(),
              })
              .eq('id', p.id)
            results.push({ participantId: p.id, status: 'failed', error: pi.status })
          }
        } catch (err) {
          const msg = err?.message || 'Charge failed'
          await sb
            .from('friend_ride_participants')
            .update({
              charge_error: msg,
              charge_attempts: (p.charge_attempts || 0) + 1,
              updated_at: new Date().toISOString(),
            })
            .eq('id', p.id)
          results.push({ participantId: p.id, status: 'failed', error: msg })
        }
        continue
      }

      // No saved card - create PaymentIntent for Payment Element / Apple Pay (user-present)
      try {
        let customerId = null
        if (profile) {
          customerId = await ensureStripeCustomer(stripe, sb, profile)
        } else if (p.email) {
          const customer = await stripe.customers.create({
            email: p.email,
            name: p.display_name,
            metadata: { participant_id: p.id, friend_ride_id: ride.id },
          })
          customerId = customer.id
        }

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
        if (customerId) piParams.customer = customerId

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

        paymentElementSecrets.push({
          participantId: p.id,
          clientSecret: pi.client_secret,
          displayName: p.display_name,
          fareCents: p.fare_cents,
          reason: 'needs_card',
        })
        results.push({ participantId: p.id, status: 'needs_card', paymentIntentId: pi.id })
      } catch (err) {
        await sb
          .from('friend_ride_participants')
          .update({ charge_error: err.message, updated_at: new Date().toISOString() })
          .eq('id', p.id)
        results.push({ participantId: p.id, status: 'failed', error: err.message })
      }
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
