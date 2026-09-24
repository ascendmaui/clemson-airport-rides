/**
 * Charge one friend-ride share.
 * Credits are held only once the card capture succeeds, or immediately when
 * credits cover the whole share. A declined or unfinished card charge does
 * not keep a credit hold — the rider is offered the full share on the card.
 */
import { feeMetadata, connectFeeFields } from '../src/lib/fareRates.js'
import { ensureStripeCustomer, markParticipantPaid } from './friendRideLib.js'
import { planSettlement, debitLots } from './creditLots.js'
import {
  cardIntentKey,
  elementIntentKey,
  friendShareChargeKey,
  isOpenPaymentIntent,
  isPaidPaymentIntent,
  reuseStoredIntent,
} from './chargeIdempotency.js'

async function loadProfile(sb, userId) {
  if (!userId) return null
  const { data } = await sb
    .from('profiles')
    .select('id, email, full_name, stripe_customer_id, stripe_default_pm_id')
    .eq('id', userId)
    .maybeSingle()
  return data
}

export async function chargeFriendShare(sb, stripe, {
  ride,
  participant,
  actingUserId,
  useCredits = true,
}) {
  const p = participant
  if (p.status === 'paid') {
    return { result: { participantId: p.id, status: 'already_paid' } }
  }
  if (!p.fare_cents || p.fare_cents <= 0) {
    return { result: { participantId: p.id, status: 'skipped', error: 'No fare' } }
  }

  const profile = await loadProfile(sb, p.user_id)
  const creditsOn = Boolean(useCredits && actingUserId && p.user_id && actingUserId === p.user_id)
  const settlement = await planSettlement(sb, {
    profileId: p.user_id,
    fareCents: p.fare_cents,
    useCredits: creditsOn,
  })

  if (settlement.cashCents <= 0) {
    await debitLots(sb, {
      profileId: p.user_id,
      debits: settlement.debits,
      note: `friend:${ride.id}:${p.id}`,
    })
    await markParticipantPaid(sb, p, null, settlement)
    return {
      result: {
        participantId: p.id,
        status: 'paid',
        method: 'credits',
        riderPaysCents: settlement.riderPaysCents,
        creditsDebitedCents: settlement.creditsDebitedCents,
      },
    }
  }

  const savedCard = Boolean(profile?.stripe_default_pm_id && (profile?.stripe_customer_id || profile))
  const chargeKey = friendShareChargeKey(ride.id, p.user_id || p.id)
  if (savedCard) {
    const customerId = await ensureStripeCustomer(stripe, sb, profile)
    try {
      await sb.from('friend_ride_participants').update({
        charge_attempts: (p.charge_attempts || 0) + 1,
        charge_error: null,
        updated_at: new Date().toISOString(),
      }).eq('id', p.id)

      const reused = await reuseStoredIntent(stripe, p.stripe_payment_intent_id, settlement.cashCents)
      const attempt = reused.action === 'create_attempt' ? reused.attempt : null
      const pi = reused.action === 'already_paid' || reused.action === 'return'
        ? reused.paymentIntent
        : await stripe.paymentIntents.create({
          amount: settlement.cashCents,
          currency: 'usd',
          customer: customerId,
          payment_method: profile.stripe_default_pm_id,
          off_session: true,
          confirm: true,
          metadata: feeMetadata(settlement.cashCents, {
            kind: 'friend_ride_share',
            friend_ride_id: ride.id,
            participant_id: p.id,
            token: ride.token,
            credits_debited_cents: settlement.creditsDebitedCents,
            rider_pays_cents: settlement.riderPaysCents,
          }),
          ...connectFeeFields(settlement.cashCents, null),
        }, { idempotencyKey: cardIntentKey(chargeKey, attempt) })

      if (isPaidPaymentIntent(pi.status)) {
        let settled = settlement
        if (settlement.creditsDebitedCents > 0) {
          try {
            await debitLots(sb, {
              profileId: p.user_id,
              debits: settlement.debits,
              note: `friend:${ride.id}:${p.id}:${pi.id}`,
            })
          } catch (err) {
            console.error('[chargeFriendShare] credit debit after capture', err)
            settled = {
              ...settlement,
              creditsDebitedCents: 0,
              creditDiscountCents: 0,
              debits: [],
              riderPaysCents: settlement.cashCents,
            }
          }
        }
        await markParticipantPaid(sb, p, pi, settled)
        return { result: { participantId: p.id, status: 'paid', paymentIntentId: pi.id, method: 'card' } }
      }

      if (isOpenPaymentIntent(pi.status)) {
        await rememberFriendIntent(sb, p, pi.id, 'requires_action')
        return openShareResult(p, pi, settlement.cashCents)
      }
      if (pi.id) {
        try { await stripe.paymentIntents.cancel(pi.id) } catch { /* already canceled */ }
      }
    } catch (err) {
      const strayPi = err?.payment_intent || err?.raw?.payment_intent
      if (strayPi && isOpenPaymentIntent(strayPi.status)) {
        await rememberFriendIntent(sb, p, strayPi.id, strayPi.status)
        return openShareResult(p, strayPi, settlement.cashCents)
      }
      const stray = strayPi?.id
      if (stray && !isPaidPaymentIntent(strayPi?.status)) {
        try { await stripe.paymentIntents.cancel(stray) } catch { /* ignore */ }
      }
      await sb.from('friend_ride_participants').update({
        charge_error: err?.message || 'Charge failed',
        updated_at: new Date().toISOString(),
      }).eq('id', p.id)
    }
  }

  const full = await planSettlement(sb, { profileId: null, fareCents: p.fare_cents, useCredits: false })
  const elementReuse = await reuseStoredIntent(stripe, p.stripe_payment_intent_id, full.cashCents)
  if (elementReuse.action === 'already_paid') {
    await markParticipantPaid(sb, p, elementReuse.paymentIntent, full)
    return { result: { participantId: p.id, status: 'paid', paymentIntentId: elementReuse.paymentIntent.id, method: 'card' } }
  }
  if (elementReuse.action === 'return') {
    return openShareResult(p, elementReuse.paymentIntent, full.cashCents)
  }
  const elementAttempt = elementReuse.action === 'create_attempt' ? elementReuse.attempt : null
  try {
    let customerId = null
    if (profile) customerId = await ensureStripeCustomer(stripe, sb, profile)
    else if (p.email) {
      const customer = await stripe.customers.create({
        email: p.email,
        name: p.display_name,
        metadata: { participant_id: p.id, friend_ride_id: ride.id },
      })
      customerId = customer.id
    }
    const piParams = {
      amount: full.cashCents,
      currency: 'usd',
      automatic_payment_methods: { enabled: true },
      metadata: feeMetadata(full.cashCents, {
        kind: 'friend_ride_share',
        friend_ride_id: ride.id,
        participant_id: p.id,
        token: ride.token,
        rider_pays_cents: full.riderPaysCents,
      }),
    }
    if (customerId) piParams.customer = customerId
    const pi = await stripe.paymentIntents.create(piParams, {
      idempotencyKey: elementIntentKey(chargeKey, elementAttempt),
    })
    await sb.from('friend_ride_participants').update({
      stripe_payment_intent_id: pi.id,
      charge_error: 'needs_card',
      charge_attempts: (p.charge_attempts || 0) + 1,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id)
    return {
      result: { participantId: p.id, status: 'needs_card', paymentIntentId: pi.id },
      secret: {
        participantId: p.id,
        clientSecret: pi.client_secret,
        displayName: p.display_name,
        fareCents: full.cashCents,
        reason: 'needs_card',
      },
    }
  } catch (err) {
    await sb.from('friend_ride_participants').update({
      charge_error: err.message,
      updated_at: new Date().toISOString(),
    }).eq('id', p.id)
    return { result: { participantId: p.id, status: 'failed', error: err.message } }
  }
}

function openShareResult(participant, pi, fareCents) {
  const needsAction = pi.status === 'requires_action' || pi.status === 'requires_confirmation'
  return {
    result: {
      participantId: participant.id,
      status: needsAction ? 'requires_action' : 'needs_card',
      paymentIntentId: pi.id,
      code: needsAction ? 'authentication_required' : 'no_payment_method',
    },
    secret: {
      participantId: participant.id,
      clientSecret: pi.client_secret,
      displayName: participant.display_name,
      fareCents,
      reason: needsAction ? 'requires_action' : 'needs_card',
    },
  }
}

async function rememberFriendIntent(sb, participant, piId, chargeError) {
  await sb.from('friend_ride_participants').update({
    stripe_payment_intent_id: piId,
    charge_error: chargeError,
    updated_at: new Date().toISOString(),
  }).eq('id', participant.id)
}
