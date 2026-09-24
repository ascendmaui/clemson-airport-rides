/**
 * Friend-ride share charge. Guests without an account still get a Payment
 * Element secret. Signed-in riders go through collectPayment (credits, then card).
 */
import { collectPayment } from './collectPayment.js'
import { elementIntentKey, friendShareChargeKey, reuseStoredIntent } from './chargeIdempotency.js'
import { ensureStripeCustomer, markParticipantPaid } from './friendRideLib.js'

export async function chargeFriendShare({
  sb,
  stripe,
  ride,
  participant,
  methods = ['credits', 'card'],
  paymentMethodId = null,
}) {
  const p = participant
  if (p.fare_cents == null) {
    return {
      result: {
        participantId: p.id,
        status: 'failed',
        code: 'fee_not_computed',
        message: 'Fare is not calculated yet. Optimize the route, then retry.',
        alternatives: ['retry'],
      },
    }
  }

  if (p.fare_cents <= 0) {
    const book = await markParticipantPaid(sb, p, { id: `zero:${p.id}`, amount: 0 }, { zero: true })
    return {
      result: {
        participantId: p.id,
        status: 'paid',
        zero: true,
        booked: book.booked,
        trip: book.trip || null,
      },
    }
  }

  let profile = null
  if (p.user_id) {
    const { data } = await sb
      .from('profiles')
      .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id')
      .eq('id', p.user_id)
      .maybeSingle()
    profile = data
  }

  if (!p.user_id) {
    const element = await openPaymentElement({ stripe, sb, ride, participant: p, profile: null })
    return element
  }

  const collected = await collectPayment({
    sb,
    stripe,
    tripId: ride.trip_id || null,
    riderId: p.user_id,
    amountCents: p.fare_cents,
    methods,
    kind: 'friend_ride_share',
    idempotencyKey: friendShareChargeKey(ride.id, p.user_id || p.id),
    existingPaymentIntentId: p.stripe_payment_intent_id || null,
    hold: Boolean(ride.trip_id),
    paymentMethodId,
    metadata: {
      friend_ride_id: ride.id,
      participant_id: p.id,
      token: ride.token,
    },
  })

  if (collected.ok) {
    const book = await markParticipantPaid(
      sb,
      p,
      { id: collected.paymentIntentId || `credits:${p.id}`, amount: p.fare_cents },
      { paymentId: collected.paymentId },
    )
    return {
      result: {
        participantId: p.id,
        status: 'paid',
        method: collected.method,
        paymentIntentId: collected.paymentIntentId,
        paymentId: collected.paymentId,
        creditsAppliedCents: collected.creditsAppliedCents,
        booked: book.booked,
        trip: book.trip || null,
      },
    }
  }

  p.stripe_payment_intent_id = collected.paymentIntentId || p.stripe_payment_intent_id || null
  await sb.from('friend_ride_participants').update({
    charge_error: collected.message || collected.code,
    charge_attempts: (p.charge_attempts || 0) + 1,
    updated_at: new Date().toISOString(),
    stripe_payment_intent_id: p.stripe_payment_intent_id,
  }).eq('id', p.id)

  if (collected.clientSecret && collected.paymentIntentId) {
    const needsCard = collected.code === 'no_payment_method'
    return {
      result: {
        participantId: p.id,
        status: needsCard ? 'needs_card' : 'requires_action',
        ...publicFailure(collected),
      },
      paymentElement: {
        participantId: p.id,
        clientSecret: collected.clientSecret,
        displayName: p.display_name,
        reason: needsCard ? 'needs_card' : 'requires_action',
        fareCents: p.fare_cents,
      },
    }
  }

  let paymentElement = null
  if (collected.code === 'no_payment_method' || collected.code === 'card_removed' || collected.code === 'expired_card') {
    const opened = await openPaymentElement({ stripe, sb, ride, participant: p, profile })
    paymentElement = opened.paymentElement || null
  }

  return {
    result: {
      participantId: p.id,
      status: collected.code === 'no_payment_method' ? 'needs_card' : 'failed',
      ...publicFailure(collected),
    },
    paymentElement,
  }
}

function publicFailure(collected) {
  return {
    code: collected.code,
    message: collected.message,
    alternatives: collected.alternatives,
    amountDueCents: collected.amountDueCents,
    creditsBalanceCents: collected.creditsBalanceCents,
    paymentRequired: true,
    paymentIntentId: collected.paymentIntentId || null,
  }
}

function elementFromIntent(participant, pi, fareCents) {
  const needsAction = pi.status === 'requires_action' || pi.status === 'requires_confirmation'
  return {
    result: {
      participantId: participant.id,
      status: needsAction ? 'requires_action' : 'needs_card',
      paymentIntentId: pi.id,
      code: needsAction ? 'authentication_required' : 'no_payment_method',
      message: needsAction
        ? 'Your bank needs you to confirm this charge.'
        : 'Add a card to pay this share.',
      alternatives: needsAction ? ['retry', 'add_card'] : ['add_card', 'use_credits', 'retry'],
      amountDueCents: fareCents,
      paymentRequired: true,
    },
    paymentElement: {
      participantId: participant.id,
      clientSecret: pi.client_secret,
      displayName: participant.display_name,
      fareCents,
      reason: needsAction ? 'requires_action' : 'needs_card',
    },
  }
}

async function openPaymentElement({ stripe, sb, ride, participant, profile }) {
  const chargeKey = friendShareChargeKey(ride.id, participant.user_id || participant.id)
  const reused = await reuseStoredIntent(stripe, participant.stripe_payment_intent_id, participant.fare_cents)
  if (reused.action === 'already_paid') {
    const book = await markParticipantPaid(sb, participant, reused.paymentIntent, { paymentId: participant.payment_id })
    return {
      result: {
        participantId: participant.id,
        status: 'paid',
        paymentIntentId: reused.paymentIntent.id,
        booked: book.booked,
        trip: book.trip || null,
      },
    }
  }
  if (reused.action === 'return') {
    return elementFromIntent(participant, reused.paymentIntent, participant.fare_cents)
  }
  const attempt = reused.action === 'create_attempt' ? reused.attempt : null
  let customerId = null
  if (profile) customerId = await ensureStripeCustomer(stripe, sb, profile)
  else if (participant.email) {
    const customer = await stripe.customers.create({
      email: participant.email,
      name: participant.display_name,
      metadata: { participant_id: participant.id, friend_ride_id: ride.id },
    })
    customerId = customer.id
  }
  const pi = await stripe.paymentIntents.create({
    amount: participant.fare_cents,
    currency: 'usd',
    customer: customerId || undefined,
    automatic_payment_methods: { enabled: true },
    metadata: {
      kind: 'friend_ride_share',
      friend_ride_id: ride.id,
      participant_id: participant.id,
      token: ride.token,
    },
  }, {
    idempotencyKey: elementIntentKey(chargeKey, attempt),
  })
  await sb.from('friend_ride_participants').update({
    stripe_payment_intent_id: pi.id,
    charge_error: 'needs_card',
    charge_attempts: (participant.charge_attempts || 0) + 1,
    updated_at: new Date().toISOString(),
  }).eq('id', participant.id)
  return {
    result: {
      participantId: participant.id,
      status: 'needs_card',
      paymentIntentId: pi.id,
      code: 'no_payment_method',
      message: 'Add a card to pay this share.',
      alternatives: ['add_card', 'use_credits', 'retry'],
      amountDueCents: participant.fare_cents,
    },
    paymentElement: {
      participantId: participant.id,
      clientSecret: pi.client_secret,
      displayName: participant.display_name,
      fareCents: participant.fare_cents,
      reason: 'needs_card',
    },
  }
}
