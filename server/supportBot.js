/**
 * Auto Support Bot. Answers common Clemson RIDES questions from product facts
 * already in the account context. Escalates when intent is unknown, confidence
 * is below the floor, the user asks for a person, or the bot cannot change
 * money, safety, or an unexplained bug.
 */
import { BOT_CONFIDENCE_FLOOR } from '../shared/adminAccess.js'
import { onboardingLabel } from '../shared/driverOnboarding.js'

export { BOT_CONFIDENCE_FLOOR }

const HUMAN = /\b(human|real person|live agent|customer service|representative|escalate|not a bot|talk to (?:a |an )?(?:person|agent|admin|someone)|speak to (?:a |an )?(?:person|agent|admin|someone))\b/i
const SAFETY = /\b(safety|unsafe|harass\w*|threat\w*|assault|emergency|scared|stalk\w*|in danger)\b/i
const REFUND = /\b(refund\w*|charged twice|double charg\w*|dispute (?:a |the )?charge)\b/i
const PAYMENT = /\b(bill\w*|charge\w*|card|deposit|payment|stripe|receipt|fare|payout|credit)\b/i
const ACCOUNT = /\b(account|login|log in|sign in|password|locked out|student|email)\b/i
const DRIVER_APP = /\b(application|approved|approval|pending review|driver status|go online|onboarding)\b/i
const RIDE = /\b(ride|trip|driver|pickup|drop(?:-|\s)?off|no-show|no show|cancel\w*|late)\b/i
const BUG = /\b(bug\w*|crash\w*|broken|error\w*|glitch\w*|freez\w*|not working|won'?t load|cannot go online|can't go online)\b/i
const DISPUTE = /\b(no-show|no show|dispute|never arrived|wrong pickup|wrong car)\b/i

function decision({ intent, confidence, status, escalate, reason, reply }) {
  return {
    intent,
    confidence,
    status,
    escalate,
    reason: reason || null,
    reply,
  }
}

function applicationReply(context) {
  const status = context?.driverApplication?.status || null
  if (!status) {
    return decision({
      intent: 'driver_application',
      confidence: 0.82,
      status: 'waiting_user',
      escalate: false,
      reason: null,
      reply: 'I do not see a driver application on this profile. Open the driver application, submit it, and ask again if the status still looks wrong. You cannot accept rides until an admin approves you.',
    })
  }
  const label = status === 'pending' ? 'Waiting for admin review' : onboardingLabel(status)
  if (status === 'approved') {
    return decision({
      intent: 'driver_application',
      confidence: 0.92,
      status: 'resolved',
      escalate: false,
      reason: null,
      reply: `Your driver application is approved. You can go online and accept rides. (${label})`,
    })
  }
  if (status === 'rejected') {
    return decision({
      intent: 'driver_application',
      confidence: 0.9,
      status: 'waiting_user',
      escalate: false,
      reason: null,
      reply: 'Your driver application needs changes. Open the driver application to read the review note, update the flagged items, and submit again. You cannot accept rides until an admin approves the new submission.',
    })
  }
  return decision({
    intent: 'driver_application',
    confidence: 0.9,
    status: 'resolved',
    escalate: false,
    reason: null,
    reply: `Your driver application status is ${label}. Pending drivers cannot accept rides. An admin reviews documents from the admin dashboard before approval unlocks ride accept.`,
  })
}

function paymentReply(text, context) {
  if (REFUND.test(text)) {
    return decision({
      intent: 'payments',
      confidence: 0.93,
      status: 'escalated',
      escalate: true,
      reason: 'refund_needs_admin',
      reply: 'I cannot refund or change a Stripe charge from chat. I flagged this ticket for an admin. Airport rides take a 25% deposit at checkout. Friend-ride charges use the card on file in Account → Billing.',
    })
  }
  const card = context?.billing?.hasCard
    ? `A ${context.billing.brand || 'card'}${context.billing.last4 ? ` ending ${context.billing.last4}` : ''} is on file.`
    : 'No card is on file. Add one in Account → Billing. Airport deposits can still be paid from Schedule checkout.'
  const latest = context?.recentTrips?.[0]
  const fare = latest?.fareUsd != null
    ? ` The newest trip I can see was $${latest.fareUsd} (${latest.pickup || 'pickup'} → ${latest.dropoff || 'dropoff'}, ${latest.status || 'status unknown'}).`
    : ''
  return decision({
    intent: 'payments',
    confidence: 0.86,
    status: 'resolved',
    escalate: false,
    reason: null,
    reply: `${card}${fare} I cannot move money from chat. If a charge looks wrong, reply with the trip and the amount and I will hand it to an admin.`,
  })
}

function accountReply(context) {
  const student = context?.student?.verified
    ? 'Student pricing is on for this profile.'
    : 'Student pricing is off for this profile. A @clemson.edu sign-in turns it on.'
  return decision({
    intent: 'account',
    confidence: 0.88,
    status: 'resolved',
    escalate: false,
    reason: null,
    reply: `${student} To reset a password, use Sign in → Forgot password. I will never ask for your password. If you are locked out after that, reply and I will escalate to an admin.`,
  })
}

function rideReply(text, context) {
  if (DISPUTE.test(text)) {
    const latest = context?.recentTrips?.[0]
    const where = latest
      ? ` Newest trip on file: ${latest.status || 'unknown'} · ${latest.pickup || 'pickup'} → ${latest.dropoff || 'dropoff'}.`
      : ''
    return decision({
      intent: 'ride',
      confidence: 0.9,
      status: 'escalated',
      escalate: true,
      reason: 'ride_dispute',
      reply: `I cannot change a completed or disputed ride from chat.${where} I flagged this for an admin.`,
    })
  }
  const latest = context?.recentTrips?.[0]
  if (!latest) {
    return decision({
      intent: 'ride',
      confidence: 0.8,
      status: 'waiting_user',
      escalate: false,
      reason: null,
      reply: 'I do not see a recent trip on this profile. Tell me the pickup, drop-off, and whether you were the rider or the driver.',
    })
  }
  const who = latest.peerFirstName ? ` The other person is ${latest.peerFirstName}.` : ''
  return decision({
    intent: 'ride',
    confidence: 0.84,
    status: 'resolved',
    escalate: false,
    reason: null,
    reply: `The newest trip I can see is ${latest.status || 'unknown'}: ${latest.pickup || 'pickup'} → ${latest.dropoff || 'dropoff'}.${who} Open Activity for the full list. I cannot edit the trip from chat.`,
  })
}

function bugReply(text, context, role) {
  if (role === 'driver' && /go online|cannot go online|can't go online/i.test(text) && !context?.vehicle) {
    return decision({
      intent: 'bug',
      confidence: 0.86,
      status: 'resolved',
      escalate: false,
      reason: null,
      reply: 'Going online needs a vehicle and an approved application. Finish the driver application first. If you are already approved and the map still fails, reply with the screen you see and I will escalate it.',
    })
  }
  return decision({
    intent: 'bug',
    confidence: 0.55,
    status: 'escalated',
    escalate: true,
    reason: 'low_confidence',
    reply: 'I cannot tell how to fix that bug from the message alone. I flagged it for an admin. Include the screen name and what you expected if you have not already.',
  })
}

function finalize(result) {
  if (result.status === 'waiting_user' && !result.escalate) return result
  if (result.escalate || result.intent === 'human' || result.intent === 'unknown' || result.confidence < BOT_CONFIDENCE_FLOOR) {
    return {
      ...result,
      status: 'escalated',
      escalate: true,
      reason: result.reason || (result.intent === 'human' ? 'human_requested' : result.intent === 'unknown' ? 'unknown_intent' : 'low_confidence'),
    }
  }
  return result
}

function routeSupportBot({ text, category, context, roleVariant } = {}) {
  const raw = String(text || '').trim()
  const role = roleVariant === 'driver' || context?.role === 'driver' ? 'driver' : 'rider'

  if (!raw || raw.length < 8) {
    return decision({
      intent: 'unknown',
      confidence: 0.2,
      status: 'waiting_user',
      escalate: false,
      reason: null,
      reply: 'Tell me whether this is about your account, a payment, a ride, or your driver application. I only escalate to an admin when I cannot resolve it.',
    })
  }

  if (HUMAN.test(raw)) {
    return decision({
      intent: 'human',
      confidence: 0.99,
      status: 'escalated',
      escalate: true,
      reason: 'human_requested',
      reply: 'I am handing this ticket to an admin for manual review. You can keep adding details here.',
    })
  }

  if (SAFETY.test(raw) || category === 'safety') {
    return decision({
      intent: 'safety',
      confidence: 0.94,
      status: 'escalated',
      escalate: true,
      reason: 'safety',
      reply: 'If you are in immediate danger, contact local emergency services before this chat. I flagged the ticket for an admin and will not close it.',
    })
  }

  if (REFUND.test(raw)) return paymentReply(raw, context)

  if (DRIVER_APP.test(raw) || category === 'driver_application') {
    return applicationReply(context)
  }

  if (PAYMENT.test(raw) || category === 'billing') {
    return paymentReply(raw, context)
  }

  if (ACCOUNT.test(raw) || category === 'account') {
    return accountReply(context)
  }

  if (RIDE.test(raw) || category === 'ride_dispute') {
    return rideReply(raw, context)
  }

  if (BUG.test(raw) || category === 'bug') {
    return bugReply(raw, context, role)
  }

  return decision({
    intent: 'unknown',
    confidence: 0.24,
    status: 'escalated',
    escalate: true,
    reason: 'unknown_intent',
    reply: 'I could not match that to account, payments, rides, or driver application status. I flagged it for an admin.',
  })
}

export function decideSupportBot(input) {
  return finalize(routeSupportBot(input))
}

export function botShouldEscalate(result) {
  if (!result) return true
  if (result.escalate) return true
  if (result.intent === 'unknown' && result.status !== 'waiting_user') return true
  if (result.confidence < BOT_CONFIDENCE_FLOOR && result.status !== 'waiting_user') return true
  return false
}
