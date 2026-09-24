/**
 * Pure payment-failure policy: structured codes, rider copy, method planning,
 * and whether a trip may complete or cancel.
 *
 * Fee math for wait time and mid-ride cancellation is NOT computed here.
 * Those owners pass `amountCents` or write a precomputed value onto trip
 * metadata. This module only reads those values and collects them.
 */
import { driverNetCents, platformFeeCents } from './platformFee.js'

export const PAYMENT_CODES = [
  'card_declined',
  'expired_card',
  'insufficient_funds',
  'card_removed',
  'credits_insufficient',
  'credits_exhausted',
  'credits_unavailable',
  'no_payment_method',
  'authentication_required',
  'charge_failed',
  'fee_not_computed',
]

const FARE_KINDS = new Set(['deposit', 'balance', 'friend_ride_share', 'mid_ride'])

function assertNever(value) {
  throw new Error(`Unhandled payment code: ${String(value)}`)
}

export function formatUsdFromCents(cents) {
  return (Number(cents) / 100).toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
  })
}

export function normalizeMethods(methods) {
  const source = Array.isArray(methods) && methods.length ? methods : ['credits', 'card']
  const out = []
  for (const method of source) {
    if (method !== 'credits' && method !== 'card') {
      throw new Error(`Unknown payment method: ${String(method)}`)
    }
    if (!out.includes(method)) out.push(method)
  }
  return out
}

export function classifyStripeError(err) {
  const raw = err?.raw && typeof err.raw === 'object' ? err.raw : {}
  const decline = String(raw.decline_code || err?.decline_code || '')
  const code = String(raw.code || err?.code || '')
  const message = String(raw.message || err?.message || '')
  const piStatus = String(raw.payment_intent?.status || err?.payment_intent?.status || '')
  const type = String(raw.type || err?.type || '')

  if (decline === 'insufficient_funds' || code === 'insufficient_funds') return 'insufficient_funds'
  if (decline === 'expired_card' || code === 'expired_card') return 'expired_card'
  if (
    code === 'resource_missing'
    || code === 'payment_method_unattached'
    || code === 'payment_method_unexpected_state'
    || /no such payment_method|payment method.*(detach|removed|does not exist)|was detached/i.test(message)
  ) {
    return 'card_removed'
  }
  if (code === 'authentication_required' || piStatus === 'requires_action') return 'authentication_required'
  if (code === 'card_declined' || decline || type === 'card_error') return 'card_declined'
  return 'charge_failed'
}

export function riderMessage(code, ctx = {}) {
  const due = formatUsdFromCents(ctx.amountCents || 0)
  const credits = formatUsdFromCents(ctx.creditsBalanceCents || 0)
  const shortfall = formatUsdFromCents(ctx.shortfallCents || 0)
  const released = ctx.creditsReleased
    ? ' Prepaid credits were not kept.'
    : ''

  switch (code) {
    case 'card_declined':
      return `Your card was declined for ${due}.${released} Add another card or use prepaid credits, then retry. This trip stays open until it is paid.`
    case 'expired_card':
      return `The card on file is expired, so ${due} was not collected.${released} Add a new card in Billing or pay with prepaid credits.`
    case 'insufficient_funds':
      return `The card on file does not cover ${due}.${released} Use another card or prepaid credits. The trip stays open until payment succeeds.`
    case 'card_removed':
      return `The card was removed, so ${due} could not be collected.${released} Add a card or use prepaid credits. The trip will not complete until payment succeeds.`
    case 'credits_insufficient':
      return `Prepaid credits cover ${credits} of ${due}. Add funds or use a card for the remaining ${shortfall}.`
    case 'credits_exhausted':
      return `Prepaid credits are used up and ${due} is still due. Add funds or pay with a card. The trip stays open until payment succeeds.`
    case 'credits_unavailable':
      return `Prepaid credits could not be applied for ${due}. Use a card or try again.`
    case 'no_payment_method':
      return `There is no card on file for ${due}. Add a card or buy prepaid credits, then retry.`
    case 'authentication_required':
      return `Your bank needs you to confirm this ${due} charge before the trip can continue.`
    case 'charge_failed':
      return `Payment of ${due} did not go through.${released} Retry, add a card, or use prepaid credits. The trip stays on hold.`
    case 'fee_not_computed':
      return 'This step needs a fee amount from the wait-time or cancellation calculator before it can charge.'
    default:
      return assertNever(code)
  }
}

export function alternativesFor(code) {
  switch (code) {
    case 'authentication_required':
      return ['retry', 'add_card', 'use_credits']
    case 'credits_insufficient':
    case 'credits_exhausted':
      return ['buy_credits', 'add_card', 'retry']
    case 'credits_unavailable':
      return ['add_card', 'retry']
    case 'no_payment_method':
    case 'card_removed':
    case 'expired_card':
      return ['add_card', 'use_credits', 'buy_credits', 'retry']
    case 'card_declined':
    case 'insufficient_funds':
    case 'charge_failed':
      return ['add_card', 'use_credits', 'buy_credits', 'retry']
    case 'fee_not_computed':
      return ['retry']
    default:
      return assertNever(code)
  }
}

export function failureResult(code, ctx = {}) {
  const amountCents = Math.max(0, Math.round(Number(ctx.amountCents) || 0))
  const creditsBalanceCents = Math.max(0, Math.round(Number(ctx.creditsBalanceCents) || 0))
  const shortfallCents = ctx.shortfallCents != null
    ? Math.max(0, Math.round(Number(ctx.shortfallCents)))
    : Math.max(0, amountCents - creditsBalanceCents)
  return {
    ok: false,
    status: 'payment_required',
    code,
    message: riderMessage(code, {
      amountCents,
      creditsBalanceCents,
      shortfallCents,
      creditsReleased: Boolean(ctx.creditsReleased),
    }),
    alternatives: alternativesFor(code),
    amountDueCents: amountCents,
    creditsBalanceCents,
    shortfallCents,
    creditsReleased: Boolean(ctx.creditsReleased),
    kind: ctx.kind || null,
    tripId: ctx.tripId || null,
  }
}

/**
 * Decide credits-then-card allocations. Does not charge anything.
 * A plan that cannot cover the full amount fails before any debit.
 */
export function planCollection({
  amountCents,
  creditsBalanceCents = 0,
  methods = ['credits', 'card'],
  hasCard = false,
  creditsUnavailable = false,
  midRide = false,
}) {
  const amount = Math.max(0, Math.round(Number(amountCents) || 0))
  const credits = Math.max(0, Math.round(Number(creditsBalanceCents) || 0))
  const order = normalizeMethods(methods)

  if (amount === 0) {
    return { ok: true, zero: true, allocations: [], amountDueCents: 0, creditsAppliedCents: 0, cardCents: 0 }
  }

  let remaining = amount
  const allocations = []

  for (const method of order) {
    if (remaining <= 0) break
    if (method === 'credits') {
      if (creditsUnavailable || credits <= 0) continue
      const use = Math.min(credits, remaining)
      allocations.push({ method: 'credits', cents: use })
      remaining -= use
      continue
    }
    if (method === 'card') {
      if (!hasCard) continue
      allocations.push({ method: 'card', cents: remaining })
      remaining = 0
      continue
    }
    return assertNever(method)
  }

  if (remaining <= 0) {
    const creditsAppliedCents = allocations.filter((a) => a.method === 'credits').reduce((s, a) => s + a.cents, 0)
    const cardCents = allocations.filter((a) => a.method === 'card').reduce((s, a) => s + a.cents, 0)
    return { ok: true, zero: false, allocations, amountDueCents: amount, creditsAppliedCents, cardCents }
  }

  const wantsCredits = order.includes('credits')
  const wantsCard = order.includes('card')
  let code = 'no_payment_method'
  if (wantsCredits && creditsUnavailable && credits <= 0 && !hasCard) code = 'credits_unavailable'
  else if (wantsCredits && !wantsCard) code = midRide && credits <= 0 ? 'credits_exhausted' : 'credits_insufficient'
  else if (wantsCredits && !hasCard && credits > 0) code = 'credits_insufficient'
  else if (wantsCredits && !hasCard && midRide && credits <= 0) code = 'credits_exhausted'
  else code = 'no_payment_method'

  return failureResult(code, {
    amountCents: amount,
    creditsBalanceCents: credits,
    shortfallCents: remaining,
  })
}

export function readPrecomputedFeeCents(trip, kind) {
  const meta = trip?.metadata || {}
  const fees = meta.fees && typeof meta.fees === 'object' ? meta.fees : {}
  const keys = {
    wait_fee: [meta.wait_fee_cents, fees.wait_cents, fees.waitFeeCents, meta.waitFeeCents],
    cancel_fee: [
      meta.cancel_fee_cents,
      meta.midride_cancel_fee_cents,
      fees.cancel_cents,
      fees.cancelFeeCents,
      meta.cancelFeeCents,
    ],
    tip: [meta.tip_cents, fees.tip_cents],
    mid_ride: [meta.mid_ride_cents, fees.mid_ride_cents, meta.midRideCents],
    balance: [],
  }
  const list = keys[kind]
  if (!list) return null
  for (const value of list) {
    if (value == null || value === '') continue
    const n = Number(value)
    if (Number.isFinite(n)) return Math.max(0, Math.round(n))
  }
  return null
}

export function sumFarePaidCents(payments) {
  return (payments || []).reduce((sum, row) => {
    if (row?.status !== 'succeeded') return sum
    const logical = row?.metadata?.logical_kind || row?.kind
    if (!FARE_KINDS.has(logical)) return sum
    return sum + (Number(row.amount_cents) || 0)
  }, 0)
}

export function paidTowardFareCents(trip, payments) {
  const meta = trip?.metadata || {}
  if (meta.fare_paid_cents != null && meta.fare_paid_cents !== '') {
    const n = Number(meta.fare_paid_cents)
    if (Number.isFinite(n)) return Math.max(0, Math.round(n))
  }
  return sumFarePaidCents(payments)
}

export function balanceDueCents({ fareCents, paidCents }) {
  return Math.max(0, Math.round(Number(fareCents) || 0) - Math.round(Number(paidCents) || 0))
}

/**
 * Amount that must succeed before the trip status changes.
 * `explicitAmountCents` wins (caller already ran fee math).
 * Otherwise wait/cancel/tip/mid-ride amounts are read from metadata.
 * Complete charges the unpaid fare plus an outstanding non-fare hold.
 */
export function amountDueForAction({
  action,
  fareCents = 0,
  paidCents = 0,
  hold = null,
  explicitAmountCents = null,
  precomputedFeeCents = null,
  requireFee = false,
}) {
  if (action === 'complete') {
    const fareMissing = fareCents == null || fareCents === '' || !Number.isFinite(Number(fareCents))
    if (fareMissing) return { amountCents: null, code: 'fare_not_set' }
  }

  if (explicitAmountCents != null && explicitAmountCents !== '') {
    return { amountCents: Math.max(0, Math.round(Number(explicitAmountCents))), code: null }
  }

  if (action === 'complete') {
    const balance = balanceDueCents({ fareCents, paidCents })
    const holdKind = hold?.kind
    const holdOpen = hold && hold.status === 'payment_required' && holdKind && !FARE_KINDS.has(holdKind)
    const extra = holdOpen ? Math.max(0, Math.round(Number(hold.amountCents) || 0)) : 0
    return { amountCents: balance + extra, code: null, kind: extra && !balance ? holdKind : 'balance' }
  }

  if (action === 'cancel' || action === 'charge') {
    if (precomputedFeeCents == null) {
      if (requireFee) return { amountCents: null, code: 'fee_not_computed' }
      return { amountCents: 0, code: null }
    }
    return { amountCents: Math.max(0, Math.round(Number(precomputedFeeCents))), code: null }
  }

  return assertNever(action)
}

export function progressionGate({ amountDueCents, payment, adminOverride = false }) {
  if (adminOverride) return { allow: true, reason: 'admin_override' }
  const due = Math.max(0, Math.round(Number(amountDueCents) || 0))
  if (due === 0) return { allow: true, reason: 'zero_due' }
  if (payment?.ok) return { allow: true, reason: 'paid' }
  return { allow: false, reason: 'payment_required', failure: payment || null }
}

export function resolvePlatformFeeCents(grossCents, metadata) {
  if (metadata?.platform_fee_cents != null && metadata.platform_fee_cents !== '') {
    const n = Number(metadata.platform_fee_cents)
    if (Number.isFinite(n)) return Math.max(0, Math.round(n))
  }
  return platformFeeCents(grossCents)
}

export function resolveDriverNetCents(trip) {
  const meta = trip?.metadata || {}
  const explicit = meta.driver_net_cents ?? meta.driver_payout_cents ?? meta.payout_cents
  if (explicit != null && explicit !== '') {
    const n = Number(explicit)
    if (Number.isFinite(n)) return Math.max(0, Math.round(n))
  }
  if (meta.payout?.amountCents != null && meta.payout.status === 'paid') {
    return Math.max(0, Math.round(Number(meta.payout.amountCents) || 0))
  }
  return driverNetCents(trip?.fare_cents)
}

export const PAYOUT_BACKOFF_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000]

export function payoutRetryAt(attemptsAfterFailure, now = Date.now()) {
  const attempts = Math.max(1, Math.round(Number(attemptsAfterFailure) || 1))
  const idx = Math.min(attempts - 1, PAYOUT_BACKOFF_MS.length - 1)
  return now + PAYOUT_BACKOFF_MS[idx]
}

export function applyPayoutAttempt(record, { ok, error, now = Date.now(), transferId = null, amountCents }) {
  const base = record || { status: 'pending', attempts: 0, amountCents: amountCents || 0 }
  if (ok) {
    return {
      ...base,
      amountCents: amountCents ?? base.amountCents,
      status: 'paid',
      pending: false,
      lastError: null,
      stripeTransferId: transferId,
      paidAt: new Date(now).toISOString(),
    }
  }
  const attempts = (Number(base.attempts) || 0) + 1
  return {
    ...base,
    amountCents: amountCents ?? base.amountCents,
    status: 'pending',
    pending: true,
    attempts,
    lastError: error || 'payout_failed',
    nextRetryAt: new Date(payoutRetryAt(attempts, now)).toISOString(),
    stripeTransferId: null,
  }
}

export function payoutIsDue(payout, now = Date.now()) {
  if (!payout || payout.status === 'paid') return false
  if (payout.status !== 'pending' && payout.status !== 'failed') return false
  if (!payout.nextRetryAt) return true
  const at = new Date(payout.nextRetryAt).getTime()
  return Number.isFinite(at) ? at <= now : true
}

export function summarizeDriverEarnings(trips) {
  let paidCents = 0
  let pendingCents = 0
  const pending = []
  for (const trip of trips || []) {
    const payout = trip?.metadata?.payout || null
    if (payout?.status === 'paid') {
      paidCents += Math.max(0, Math.round(Number(payout.amountCents ?? resolveDriverNetCents(trip)) || 0))
      continue
    }
    if (payout && (payout.status === 'pending' || payout.status === 'failed')) {
      const amountCents = Math.max(0, Math.round(Number(payout.amountCents ?? resolveDriverNetCents(trip)) || 0))
      pendingCents += amountCents
      pending.push({
        tripId: trip.id,
        amountCents,
        status: 'pending',
        attempts: payout.attempts || 0,
        lastError: payout.lastError || null,
        nextRetryAt: payout.nextRetryAt || null,
        dropoffLabel: trip.dropoff_label || null,
      })
    }
  }
  return { paidCents, pendingCents, pending }
}

export function isFareKind(kind) {
  return FARE_KINDS.has(kind)
}
