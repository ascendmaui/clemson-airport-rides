/**
 * Admin dashboard money actions.
 *
 * Refunds try Stripe refunds.create against an existing card charge.
 * If that cannot run, the amount is recorded as rider ride credit.
 * Credits use the existing credit paths (rider credit lots, or the
 * credit-balance store for drivers). Driver incentives are recorded as
 * owed payouts and are not transferred.
 *
 * This module never creates a charge, changes a customer, or touches
 * subscriptions. Callers pass a Stripe client; tests pass a fake.
 */
import { canUseAdminMoney } from '../shared/adminAccess.js'
import { formatUsdFromCents } from '../shared/paymentFailure.js'

export const ADMIN_MONEY_ACTIONS = ['refund', 'credit', 'incentive']

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MIN_CENTS = 1
const MAX_CENTS = 200_000
const REFUNDABLE_KINDS = new Set([
  'deposit',
  'balance',
  'ride_fare',
  'tip',
  'friend_ride_share',
  'wait_fee',
  'cancellation_fee',
  'cancel_fee',
  'mid_ride',
])

function assertNever(value) {
  throw new Error(`Unhandled admin money action: ${String(value)}`)
}

function missingRelation(error) {
  return /relation|does not exist|schema cache|could not find the table/i.test(error?.message || '')
}

export function isAdminMoneyAction(action) {
  return ADMIN_MONEY_ACTIONS.includes(action)
}

export function stripeRefundCaller(stripe) {
  const create = stripe?.refunds?.create
  if (typeof create !== 'function') return null
  return {
    refunds: {
      create(params, options) {
        return create.call(stripe.refunds, params, options)
      },
    },
  }
}

function personFromProfile(profile, role) {
  return {
    id: profile.id,
    fullName: String(profile.full_name || '').trim(),
    email: String(profile.email || '').trim(),
    role,
  }
}

function personLine(person) {
  const name = person.fullName || 'No name'
  const email = person.email || 'no email'
  return `${name} (${email})`
}

function audienceRole(profile) {
  const role = String(profile?.role || '').trim().toLowerCase()
  if (role === 'driver') return 'driver'
  if (role === 'rider' || role === '') return 'rider'
  return null
}

function metaOf(row) {
  const raw = row?.metadata
  if (!raw) return {}
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw)
      return parsed && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }
  return typeof raw === 'object' ? raw : {}
}

function settlementLabel(settlement) {
  switch (settlement) {
    case 'stripe_refund':
      return 'Stripe refund to the card that was charged'
    case 'recorded_credit':
      return 'Recorded as ride credit, not a Stripe refund'
    case 'credit_balance':
      return 'Added to the credit balance'
    case 'credit_lot':
      return 'Added as ride credit for a future trip'
    case 'owed_payout':
      return 'Recorded as owed to the driver, not transferred'
    case 'incentive_credit':
      return 'Recorded as ride credit, not a cash payout'
    default:
      return assertNever(settlement)
  }
}

export function moneyConfirmation({ action, person, amountCents, settlement, reason }) {
  const who = personLine(person)
  const amount = formatUsdFromCents(amountCents)
  const role = person.role === 'driver' ? 'driver' : 'rider'
  switch (action) {
    case 'refund':
      if (settlement === 'stripe_refund') {
        return `Refund ${amount} to ${who}, a rider? This sends a Stripe refund of ${amount} to the card charged for this rider. It does not charge a card and does not change the driver's payout.`
      }
      return `Refund ${amount} to ${who}, a rider? ${reason || 'No card charge can be refunded automatically.'} This records ${amount} as ride credit. This is not a Stripe refund. It does not charge a card.`
    case 'credit':
      if (role === 'driver') {
        return `Add ${amount} in ride credit to ${who}, a driver? This adds ${amount} to their credit balance. It does not charge a card and does not send a payout.`
      }
      return `Add ${amount} in ride credit to ${who}, a rider? This adds ${amount} as ride credit for a future trip. It does not charge a card.`
    case 'incentive':
      if (role === 'driver') {
        return `Issue a ${amount} incentive to ${who}, a driver? This records ${amount} as owed to the driver. It is not transferred. It does not charge a card.`
      }
      return `Issue a ${amount} incentive to ${who}, a rider? This records ${amount} as ride credit. It is not a cash payout. It does not charge a card.`
    default:
      return assertNever(action)
  }
}

function moneyResult({ action, person, amountCents, settlement, duplicate, stripeRefundId, reason }) {
  const who = personLine(person)
  const amount = formatUsdFromCents(amountCents)
  if (duplicate) {
    return `Already recorded for ${who}. ${amount} was not applied again.`
  }
  switch (settlement) {
    case 'stripe_refund':
      return `Refunded ${amount} to ${who} with Stripe refund ${stripeRefundId || 'created'}. This was a card refund, not ride credit. No card was charged.${reason ? ` ${reason}` : ''}`
    case 'recorded_credit':
      return `${reason ? `${reason} ` : ''}Recorded ${amount} as ride credit for ${who}. This was not a Stripe refund. No card was charged.`
    case 'credit_balance':
      return `Added ${amount} in ride credit for ${who}. No card was charged and no payout was sent.${reason ? ` ${reason}` : ''}`
    case 'credit_lot':
      return `Added ${amount} as ride credit for ${who}. No card was charged.${reason ? ` ${reason}` : ''}`
    case 'owed_payout':
      return `Recorded a ${amount} incentive as owed to ${who}. It was not transferred to a Stripe account. No card was charged.${reason ? ` ${reason}` : ''}`
    case 'incentive_credit':
      return `Recorded a ${amount} incentive as ride credit for ${who}. It was not paid out in cash. No card was charged.${reason ? ` ${reason}` : ''}`
    default:
      return assertNever(settlement)
  }
}

function parseMoneyRequest(action, body) {
  if (!isAdminMoneyAction(action)) return { error: 'Unknown money action' }
  const profileId = String(body?.profileId || body?.profile_id || '')
  if (!UUID.test(profileId)) return { error: 'profileId must be a uuid' }
  const amountCents = Number(body?.amountCents)
  if (!Number.isSafeInteger(amountCents) || amountCents < MIN_CENTS || amountCents > MAX_CENTS) {
    return { error: 'amountCents must be a whole number of cents from 1 to 200000' }
  }
  const tripRaw = body?.tripId || body?.trip_id || ''
  const tripId = tripRaw ? String(tripRaw) : ''
  if (tripId && !UUID.test(tripId)) return { error: 'tripId must be a uuid' }
  const note = String(body?.note || '').trim()
  if (note.length > 280) return { error: 'Note must be 280 characters or less' }
  const confirmed = body?.confirmed === true
  const requestId = String(body?.requestId || body?.request_id || '')
  if (confirmed && !UUID.test(requestId)) return { error: 'requestId must be a uuid' }
  return {
    profileId,
    amountCents,
    tripId: tripId || null,
    note,
    confirmed,
    requestId: requestId || null,
  }
}

async function loadProfile(sb, profileId) {
  const row = await sb
    .from('profiles')
    .select('id, full_name, email, phone, role')
    .eq('id', profileId)
    .maybeSingle()
  if (row.error) return { error: row.error.message, status: 500 }
  if (!row.data) return { error: 'Person not found', status: 404 }
  return { profile: row.data }
}

async function loadPayments(sb, profileId) {
  const columns = 'id, rider_id, trip_id, kind, amount_cents, status, stripe_payment_intent_id, metadata, created_at'
  let result = await sb.from('payments').select(columns).eq('rider_id', profileId).order('created_at', { ascending: false }).limit(80)
  if (result.error && /column|schema cache/i.test(result.error.message || '') && !missingRelation(result.error)) {
    result = await sb
      .from('payments')
      .select('id, rider_id, trip_id, kind, amount_cents, status, stripe_payment_intent_id')
      .eq('rider_id', profileId)
      .limit(80)
  }
  if (result.error) {
    if (missingRelation(result.error)) return { payments: [] }
    return { error: result.error.message, status: 500 }
  }
  return { payments: result.data || [] }
}

function refundableCharges(payments, tripId) {
  return (payments || []).filter((row) => {
    if (tripId && row.trip_id !== tripId) return false
    const status = String(row.status || '')
    if (status !== 'succeeded' && status !== 'paid') return false
    if (!REFUNDABLE_KINDS.has(String(row.kind || ''))) return false
    if (!row.stripe_payment_intent_id) return false
    return true
  })
}

function alreadyRefundedCents(payments, paymentId) {
  return (payments || []).reduce((sum, row) => {
    if (String(row.kind || '') !== 'refund') return sum
    const meta = metaOf(row)
    if (meta.source_payment_id !== paymentId) return sum
    return sum + Math.max(0, Math.round(Number(row.amount_cents) || 0))
  }, 0)
}

function pickStripeCharge(payments, amountCents, tripId) {
  const charges = refundableCharges(payments, tripId)
    .map((row) => {
      const available = Math.max(0, Math.round(Number(row.amount_cents) || 0) - alreadyRefundedCents(payments, row.id))
      return { row, available }
    })
    .filter((item) => item.available >= amountCents)
    .sort((a, b) => a.available - b.available)
  return charges[0]?.row || null
}

function priorRefund(payments, requestId) {
  if (!requestId) return null
  return (payments || []).find((row) => metaOf(row).admin_request_id === requestId) || null
}

function planSettlement({ action, role, stripeAvailable, charge }) {
  switch (action) {
    case 'refund': {
      if (stripeAvailable && charge) {
        return { settlement: 'stripe_refund', reason: null }
      }
      if (!stripeAvailable) {
        return {
          settlement: 'recorded_credit',
          reason: 'Stripe is not configured, so a card refund cannot run automatically.',
        }
      }
      return {
        settlement: 'recorded_credit',
        reason: 'No card charge on file covers this amount, so a Stripe refund cannot run automatically.',
      }
    }
    case 'credit':
      return { settlement: role === 'driver' ? 'credit_balance' : 'credit_lot', reason: null }
    case 'incentive':
      return { settlement: role === 'driver' ? 'owed_payout' : 'incentive_credit', reason: null }
    default:
      return assertNever(action)
  }
}

function publicPlan({ action, person, amountCents, settlement, reason, charge }) {
  return {
    ok: true,
    action,
    amountCents,
    amountLabel: formatUsdFromCents(amountCents),
    person,
    settlement,
    settlementLabel: settlementLabel(settlement),
    reason: reason || null,
    chargeId: charge?.id || null,
    confirmation: moneyConfirmation({ action, person, amountCents, settlement, reason }),
  }
}

async function insertRefundPayment(sb, { profileId, tripId, amountCents, requestId, adminId, settlement, stripeRefundId, sourcePaymentId, note, reason }) {
  const inserted = await sb.from('payments').insert({
    trip_id: tripId || null,
    rider_id: profileId,
    stripe_payment_intent_id: null,
    kind: 'refund',
    amount_cents: amountCents,
    platform_fee_cents: 0,
    driver_earnings_cents: 0,
    status: 'succeeded',
    metadata: {
      admin_action: 'refund',
      admin_request_id: requestId,
      admin_id: adminId,
      settlement,
      stripe_refund_id: stripeRefundId || null,
      source_payment_id: sourcePaymentId || null,
      note: note || null,
      reason: reason || null,
    },
  }).select('id').maybeSingle()
  if (inserted.error) return { error: inserted.error.message }
  return { id: inserted.data?.id || null }
}

async function findLedgerMarker(sb, profileId, marker) {
  const listed = await sb
    .from('rider_credit_ledger')
    .select('id, lot_id, note, amount_cents')
    .eq('profile_id', profileId)
    .order('created_at', { ascending: false })
    .limit(40)
  if (listed.error) {
    if (missingRelation(listed.error)) return { missing: true, row: null }
    return { error: listed.error.message }
  }
  const row = (listed.data || []).find((item) => String(item.note || '').includes(marker)) || null
  return { row, missing: false }
}

async function grantCreditStore(credits, { profileId, amountCents, action, requestId, tripId }) {
  if (!credits?.applyCredits) return { ok: false, error: 'Credit balance is not available' }
  const applied = await credits.applyCredits(profileId, amountCents, {
    kind: action === 'incentive' ? 'admin_incentive' : action === 'refund' ? 'refund' : 'admin_credit',
    tripId: tripId || null,
    idempotencyKey: `admin:${action}:${requestId}`,
  })
  if (!applied?.ok) return { ok: false, error: applied?.code || 'credits_unavailable' }
  return {
    ok: true,
    duplicate: Boolean(applied.duplicate),
    balanceCents: applied.balanceCents ?? null,
    via: 'credit_balance',
  }
}

async function grantRiderLot(sb, credits, { profileId, amountCents, action, requestId, tripId, note }) {
  const marker = `admin:${action}:${requestId}`
  const prior = await findLedgerMarker(sb, profileId, marker)
  if (prior.error) return { ok: false, error: prior.error }
  if (prior.row) return { ok: true, duplicate: true, lotId: prior.row.lot_id || null, via: 'credit_lot' }
  if (prior.missing) {
    const fallback = await grantCreditStore(credits, { profileId, amountCents, action, requestId, tripId })
    if (!fallback.ok) return fallback
    return { ...fallback, fallback: true }
  }

  const packId = action === 'refund' ? 'admin_refund' : action === 'incentive' ? 'admin_incentive' : 'admin_credit'
  const inserted = await sb.from('rider_credit_lots').insert({
    profile_id: profileId,
    pack_id: packId,
    load_cents: amountCents,
    discount_bps: 0,
    remaining_cents: amountCents,
    status: 'available',
  }).select('id').maybeSingle()
  if (inserted.error) {
    if (missingRelation(inserted.error) || prior.missing) {
      const fallback = await grantCreditStore(credits, { profileId, amountCents, action, requestId, tripId })
      if (!fallback.ok) return fallback
      return { ...fallback, fallback: true }
    }
    return { ok: false, error: inserted.error.message }
  }
  const lotId = inserted.data?.id || null
  const ledgerKind = action === 'refund' ? 'refund' : 'purchase'
  const ledger = await sb.from('rider_credit_ledger').insert({
    profile_id: profileId,
    lot_id: lotId,
    kind: ledgerKind,
    amount_cents: amountCents,
    discount_cents: 0,
    trip_id: tripId || null,
    note: note ? `${marker} ${note}` : marker,
  })
  if (ledger.error && !missingRelation(ledger.error)) {
    return { ok: false, error: ledger.error.message, lotId }
  }
  return { ok: true, duplicate: false, lotId, via: 'credit_lot' }
}

async function recordOwedIncentive(sb, { profileId, amountCents, requestId }) {
  const marker = `admin_request:${requestId}`
  const listed = await sb
    .from('driver_payouts')
    .select('id, driver_id, amount_cents, status, last_error')
    .eq('driver_id', profileId)
    .limit(50)
  if (listed.error && !missingRelation(listed.error)) return { ok: false, error: listed.error.message }
  const existing = (listed.data || []).find((row) => row.last_error === marker)
  if (existing) return { ok: true, duplicate: true, payoutId: existing.id || null }

  const inserted = await sb.from('driver_payouts').insert({
    trip_id: null,
    driver_id: profileId,
    amount_cents: amountCents,
    status: 'owed',
    attempts: 0,
    last_error: marker,
    next_retry_at: null,
    stripe_transfer_id: null,
    updated_at: new Date().toISOString(),
  }).select('id').maybeSingle()
  if (inserted.error) {
    if (missingRelation(inserted.error)) {
      return { ok: false, error: 'Driver payouts are not available, so the incentive was not recorded and was not transferred.' }
    }
    return { ok: false, error: inserted.error.message }
  }
  return { ok: true, duplicate: false, payoutId: inserted.data?.id || null }
}

function done(plan, extra) {
  const settlement = extra.settlement || plan.settlement
  const reason = extra.reason === undefined ? plan.reason : extra.reason
  const body = {
    ...publicPlan({
      action: plan.action,
      person: plan.person,
      amountCents: plan.amountCents,
      settlement,
      reason,
      charge: plan.charge,
    }),
    preview: false,
    executed: true,
    duplicate: Boolean(extra.duplicate),
    stripeRefundId: extra.stripeRefundId || null,
    balanceCents: extra.balanceCents ?? null,
    lotId: extra.lotId || null,
    payoutId: extra.payoutId || null,
    result: moneyResult({
      action: plan.action,
      person: plan.person,
      amountCents: plan.amountCents,
      settlement,
      duplicate: Boolean(extra.duplicate),
      stripeRefundId: extra.stripeRefundId || null,
      reason,
    }),
  }
  return { status: 200, body }
}

export async function runAdminMoneyAction({
  sb,
  action,
  body,
  adminUser,
  access,
  stripe = null,
  stripeAvailable = false,
  credits = null,
}) {
  if (!canUseAdminMoney({
    jwtEmail: adminUser?.email,
    profileEmail: access?.profile?.email,
    isAdmin: access?.admin === true,
  })) {
    return { status: 403, body: { error: 'Admin only' } }
  }

  const parsed = parseMoneyRequest(action, body || {})
  if (parsed.error) return { status: 400, body: { error: parsed.error } }

  const loaded = await loadProfile(sb, parsed.profileId)
  if (loaded.error) return { status: loaded.status, body: { error: loaded.error } }
  const role = audienceRole(loaded.profile)
  if (!role || (action === 'refund' && role !== 'rider') || (role !== 'rider' && role !== 'driver')) {
    const error = action === 'refund'
      ? 'Refunds are for riders.'
      : 'Credits and incentives can be issued to riders and drivers.'
    return { status: 400, body: { error } }
  }
  if (parsed.tripId && action !== 'refund') {
    return { status: 400, body: { error: 'tripId is only used for refunds' } }
  }

  let payments = []
  let charge = null
  if (action === 'refund') {
    if (parsed.tripId) {
      const trip = await sb.from('trips').select('id, rider_id').eq('id', parsed.tripId).maybeSingle()
      if (trip.error) return { status: 500, body: { error: trip.error.message } }
      if (!trip.data) return { status: 404, body: { error: 'Trip not found' } }
      if (trip.data.rider_id !== loaded.profile.id) {
        return { status: 400, body: { error: 'That trip is not this rider’s' } }
      }
    }
    const listed = await loadPayments(sb, loaded.profile.id)
    if (listed.error) return { status: listed.status, body: { error: listed.error } }
    payments = listed.payments
    const earlier = priorRefund(payments, parsed.requestId)
    if (earlier && parsed.confirmed) {
      const person = personFromProfile(loaded.profile, role)
      const settlement = metaOf(earlier).settlement === 'stripe_refund' ? 'stripe_refund' : 'recorded_credit'
      return done({
        action,
        person,
        amountCents: parsed.amountCents,
        settlement,
        reason: null,
        charge: null,
      }, {
        duplicate: true,
        settlement,
        stripeRefundId: metaOf(earlier).stripe_refund_id || null,
      })
    }
    charge = pickStripeCharge(payments, parsed.amountCents, parsed.tripId)
  }

  const person = personFromProfile(loaded.profile, role)
  const planned = planSettlement({
    action,
    role,
    stripeAvailable: Boolean(stripeAvailable),
    charge,
  })
  const plan = {
    action,
    person,
    amountCents: parsed.amountCents,
    settlement: planned.settlement,
    reason: planned.reason,
    charge,
  }
  const preview = {
    ...publicPlan(plan),
    preview: true,
    executed: false,
  }
  if (!parsed.confirmed) return { status: 200, body: preview }

  const caller = stripeRefundCaller(stripe)
  if (action === 'refund' && plan.settlement === 'stripe_refund' && caller && plan.charge) {
    try {
      const refund = await caller.refunds.create({
        payment_intent: plan.charge.stripe_payment_intent_id,
        amount: parsed.amountCents,
        metadata: {
          profile_id: person.id,
          admin_id: adminUser?.id || '',
          admin_request_id: parsed.requestId,
          source: 'admin_dashboard',
        },
      }, { idempotencyKey: `admin-refund:${parsed.requestId}` })
      const recorded = await insertRefundPayment(sb, {
        profileId: person.id,
        tripId: parsed.tripId || plan.charge.trip_id || null,
        amountCents: parsed.amountCents,
        requestId: parsed.requestId,
        adminId: adminUser?.id || null,
        settlement: 'stripe_refund',
        stripeRefundId: refund?.id || null,
        sourcePaymentId: plan.charge.id,
        note: parsed.note,
        reason: null,
      })
      return done(plan, {
        settlement: 'stripe_refund',
        stripeRefundId: refund?.id || null,
        reason: recorded.error ? `Stripe refund ${refund?.id || ''} was created. The local refund row could not be saved (${recorded.error}).` : null,
      })
    } catch (err) {
      const stripeReason = `Stripe could not refund the card (${String(err?.message || 'refund failed').replace(/\s+/g, ' ').slice(0, 180)}).`
      const granted = await grantRiderLot(sb, credits, {
        profileId: person.id,
        amountCents: parsed.amountCents,
        action: 'refund',
        requestId: parsed.requestId,
        tripId: parsed.tripId,
        note: parsed.note,
      })
      if (!granted.ok) {
        return { status: 502, body: { error: `${stripeReason} Ride credit was not recorded either (${granted.error}). No card was charged.` } }
      }
      await insertRefundPayment(sb, {
        profileId: person.id,
        tripId: parsed.tripId || null,
        amountCents: parsed.amountCents,
        requestId: parsed.requestId,
        adminId: adminUser?.id || null,
        settlement: 'recorded_credit',
        stripeRefundId: null,
        sourcePaymentId: plan.charge?.id || null,
        note: parsed.note,
        reason: stripeReason,
      })
      return done(plan, {
        settlement: 'recorded_credit',
        reason: stripeReason,
        duplicate: granted.duplicate,
        lotId: granted.lotId || null,
        balanceCents: granted.balanceCents ?? null,
      })
    }
  }

  if (action === 'refund') {
    const granted = await grantRiderLot(sb, credits, {
      profileId: person.id,
      amountCents: parsed.amountCents,
      action: 'refund',
      requestId: parsed.requestId,
      tripId: parsed.tripId,
      note: parsed.note,
    })
    if (!granted.ok) return { status: 503, body: { error: `Ride credit was not recorded (${granted.error}). No card was charged.` } }
    const reason = granted.fallback
      ? `${plan.settlement === 'stripe_refund' ? 'A Stripe refund could not be started.' : (plan.reason || '')} Credit lots are unavailable, so this was recorded on the credit balance instead.`.trim()
      : (plan.settlement === 'stripe_refund'
        ? 'A Stripe refund could not be started, so this was recorded as ride credit.'
        : plan.reason)
    if (!granted.duplicate) {
      await insertRefundPayment(sb, {
        profileId: person.id,
        tripId: parsed.tripId || null,
        amountCents: parsed.amountCents,
        requestId: parsed.requestId,
        adminId: adminUser?.id || null,
        settlement: 'recorded_credit',
        stripeRefundId: null,
        sourcePaymentId: null,
        note: parsed.note,
        reason,
      })
    }
    return done(plan, {
      settlement: 'recorded_credit',
      reason,
      duplicate: granted.duplicate,
      lotId: granted.lotId || null,
      balanceCents: granted.balanceCents ?? null,
    })
  }

  if (action === 'credit' && role === 'driver') {
    const granted = await grantCreditStore(credits, {
      profileId: person.id,
      amountCents: parsed.amountCents,
      action: 'credit',
      requestId: parsed.requestId,
      tripId: null,
    })
    if (!granted.ok) return { status: 503, body: { error: `Credit was not recorded (${granted.error}). No card was charged and no payout was sent.` } }
    return done(plan, {
      settlement: 'credit_balance',
      duplicate: granted.duplicate,
      balanceCents: granted.balanceCents ?? null,
    })
  }

  if (action === 'credit' || (action === 'incentive' && role === 'rider')) {
    const granted = await grantRiderLot(sb, credits, {
      profileId: person.id,
      amountCents: parsed.amountCents,
      action,
      requestId: parsed.requestId,
      tripId: null,
      note: parsed.note,
    })
    if (!granted.ok) return { status: 503, body: { error: `This was not recorded (${granted.error}). No card was charged.` } }
    const settlement = action === 'incentive'
      ? 'incentive_credit'
      : (granted.via === 'credit_balance' ? 'credit_balance' : 'credit_lot')
    const reason = granted.fallback
      ? 'Credit lots are unavailable, so this was recorded on the credit balance instead.'
      : null
    return done(plan, {
      settlement,
      reason,
      duplicate: granted.duplicate,
      lotId: granted.lotId || null,
      balanceCents: granted.balanceCents ?? null,
    })
  }

  if (action === 'incentive' && role === 'driver') {
    const owed = await recordOwedIncentive(sb, {
      profileId: person.id,
      amountCents: parsed.amountCents,
      requestId: parsed.requestId,
    })
    if (!owed.ok) return { status: 503, body: { error: owed.error } }
    return done(plan, {
      settlement: 'owed_payout',
      duplicate: owed.duplicate,
      payoutId: owed.payoutId || null,
    })
  }

  return assertNever(action)
}
