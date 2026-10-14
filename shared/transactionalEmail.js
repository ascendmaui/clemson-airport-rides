/**
 * Copy for transactional mail. Sending stays in server/transactionalMail.js,
 * which posts through the existing Resend helper.
 */
import { supportEmail } from './productLinks.js'

export const TRANSACTIONAL_KINDS = Object.freeze([
  'ride_confirmation',
  'receipt',
  'cancellation',
  'driver_approved',
  'driver_declined',
  'payout_notice',
])

function money(cents) {
  const n = Math.round(Number(cents) || 0)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${(abs / 100).toFixed(2)}`
}

function supportLine(env) {
  return `Questions: ${supportEmail(env)}`
}

function place(trip, key, fallback) {
  const value = String(trip?.[key] || '').trim()
  return value || fallback
}

function rideConfirmationEmail(trip, env) {
  const when = trip?.scheduled_at || trip?.pickup_at || trip?.pickup_time || ''
  return {
    kind: 'ride_confirmation',
    subject: 'Your Clemson RIDES trip is confirmed',
    text: [
      'Your ride is confirmed.',
      trip?.id ? `Trip ${trip.id}` : null,
      `From: ${place(trip, 'pickup_label', 'Pickup')}`,
      `To: ${place(trip, 'dropoff_label', 'Dropoff')}`,
      when ? `Pickup: ${when}` : null,
      'Your card is pre-authorized for the estimated fare. This is a hold, not a charge. The full fare is charged when the trip ends. If you cancel within policy, the hold is released.',
      supportLine(env),
    ].filter(Boolean).join('\n'),
  }
}

function receiptEmail(trip, env) {
  const fare = Math.round(Number(trip?.fare_cents) || 0)
  const tip = Math.round(Number(trip?.tip_cents) || 0)
  const wait = Math.max(0, Math.round(Number(trip?.wait_fee_cents) || 0))
  return {
    kind: 'receipt',
    subject: 'Your Clemson RIDES receipt',
    text: [
      'Clemson RIDES receipt',
      trip?.id ? `Trip ${trip.id}` : null,
      `From: ${place(trip, 'pickup_label', 'Pickup')}`,
      `To: ${place(trip, 'dropoff_label', 'Dropoff')}`,
      `Fare: ${money(fare)}`,
      wait > 0 ? `Wait time: ${money(wait)}` : null,
      `Tip: ${money(tip)}`,
      `Total: ${money(fare + tip + wait)}`,
      'The full fare is charged when the trip ends. Until then, there is only a hold on the card for the estimate. If the trip is canceled within policy, the hold is released.',
      supportLine(env),
    ].filter(Boolean).join('\n'),
  }
}

function cancellationEmail(trip, env) {
  const reason = String(trip?.reason || trip?.cancel_reason || '').trim()
  return {
    kind: 'cancellation',
    subject: 'Your Clemson RIDES trip was canceled',
    text: [
      'This ride is canceled.',
      trip?.id ? `Trip ${trip.id}` : null,
      `From: ${place(trip, 'pickup_label', 'Pickup')}`,
      `To: ${place(trip, 'dropoff_label', 'Dropoff')}`,
      reason ? `Reason: ${reason}` : null,
      'A pre-authorization hold that was not captured is released.',
      supportLine(env),
    ].filter(Boolean).join('\n'),
  }
}

function driverDecisionEmail(ctx, env, decision) {
  const name = String(ctx?.name || '').trim()
  const greeting = name ? `Hi ${name},` : 'Hi,'
  const reason = String(ctx?.reason || '').trim()
  if (decision === 'approve') {
    return {
      kind: 'driver_approved',
      subject: 'You are approved to drive with Clemson RIDES',
      text: [
        greeting,
        'Your driver application is approved. You can go online and receive rides.',
        supportLine(env),
      ].join('\n'),
    }
  }
  return {
    kind: 'driver_declined',
    subject: 'Your Clemson RIDES driver application',
    text: [
      greeting,
      'We could not approve your driver application.',
      reason ? `Reason: ${reason}` : null,
      'You can reply to this email if you have a question.',
      supportLine(env),
    ].filter(Boolean).join('\n'),
  }
}

function payoutNoticeEmail(ctx, env) {
  const amount = money(ctx?.amountCents ?? ctx?.amount_cents)
  const tripId = ctx?.tripId || ctx?.trip_id || ctx?.id || ''
  return {
    kind: 'payout_notice',
    subject: 'Your Clemson RIDES payout was sent',
    text: [
      `A payout of ${amount} was sent${tripId ? ` for trip ${tripId}` : ''}.`,
      'This is a transfer of earnings from completed trips. It is not a rider charge.',
      supportLine(env),
    ].join('\n'),
  }
}

export function transactionalEmail(kind, ctx, env) {
  switch (kind) {
    case 'ride_confirmation':
      return rideConfirmationEmail(ctx, env)
    case 'receipt':
      return receiptEmail(ctx, env)
    case 'cancellation':
      return cancellationEmail(ctx, env)
    case 'driver_approved':
      return driverDecisionEmail(ctx, env, 'approve')
    case 'driver_declined':
      return driverDecisionEmail(ctx, env, 'decline')
    case 'payout_notice':
      return payoutNoticeEmail(ctx, env)
    default:
      return null
  }
}
