/**
 * Airport Checkout can insert a searching or scheduled trip before Stripe is paid.
 * A canceled, expired, or unfinished session must take that unpaid trip out of the
 * match pool. A paid deposit leaves the trip in searching, offered, requested, or
 * scheduled. Replays are safe: a recorded deposit or a paid session is never canceled.
 *
 * If the rider never returns and Stripe never delivers checkout.session.expired,
 * releaseExpiredUnpaidAirportHolds cancels the unpaid airport hold after
 * UNPAID_AIRPORT_HOLD_TTL_MS. The cancel uses the same trip update and trip_event
 * as the webhook, including checkout_abandoned, so a later paid deposit still restores.
 * Overlapping sweeps expire an open Checkout session only after a conditional
 * claim, and write trip_events only when the status update still matches.
 */
import { isAirportDepositPaid, isAirportDepositTrip } from '../packages/rides-native/tripTags.js'

export const UNPAID_CHECKOUT_STATUSES = ['searching', 'offered', 'scheduled']

/** Pool TTL for an unpaid airport-deposit hold. Inside the 15–30 minute window. */
export const UNPAID_AIRPORT_HOLD_TTL_MS = 20 * 60 * 1000

const LIVE_MATCH_STATUSES = [
  'searching',
  'offered',
  'requested',
  'scheduled',
  'accepted',
  'arriving',
  'arrived',
  'in_progress',
  'completed',
]

export function sessionPaymentState(session) {
  const payment = String(session?.payment_status || '')
  const status = String(session?.status || '')
  if (payment === 'paid' || payment === 'no_payment_required') return 'paid'
  if (status === 'complete') return 'async_pending'
  return 'unpaid'
}

export function depositSucceeded(payments) {
  return (payments || []).some((row) => {
    const kind = String(row?.kind || '')
    const status = String(row?.status || '')
    const isDeposit = kind === 'deposit' || kind === 'airport_deposit'
    return isDeposit && /^(succeeded|paid|complete|completed)$/i.test(status)
  })
}

function boundSessionId(trip) {
  const raw = trip?.metadata?.stripe_checkout_session_id
  return typeof raw === 'string' && raw ? raw : ''
}

function parsedMs(value) {
  if (typeof value !== 'string' || !value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

/**
 * Later of trip insert and Checkout session bind.
 * A new session on an older row gets a full TTL from the bind time.
 */
export function airportHoldAnchorMs(trip) {
  const created = parsedMs(trip?.created_at)
  const session = parsedMs(metaObject(trip).stripe_checkout_created_at)
  if (created == null) return session
  if (session == null) return created
  return Math.max(created, session)
}

/**
 * @returns {{ action: 'cancel' | 'keep' | 'skip', reason: string, status?: string }}
 */
export function decideUnpaidAirportHoldTtl({
  trip,
  payments,
  now = Date.now(),
  ttlMs = UNPAID_AIRPORT_HOLD_TTL_MS,
} = {}) {
  if (!trip) return { action: 'skip', reason: 'missing_trip' }
  if (!isAirportDepositTrip(trip)) {
    return { action: 'skip', reason: 'not_airport_deposit', status: trip.status }
  }
  if (trip.driver_id) return { action: 'skip', reason: 'driver_assigned', status: trip.status }
  if (!UNPAID_CHECKOUT_STATUSES.includes(trip.status)) {
    return { action: 'skip', reason: 'not_in_pool', status: trip.status }
  }
  if (isAirportDepositPaid(trip) || depositSucceeded(payments)) {
    return { action: 'keep', reason: 'paid', status: trip.status }
  }
  const anchor = airportHoldAnchorMs(trip)
  if (anchor == null) return { action: 'skip', reason: 'missing_anchor', status: trip.status }
  if (now - anchor < ttlMs) return { action: 'skip', reason: 'within_ttl', status: trip.status }
  return { action: 'cancel', reason: 'unpaid_hold_ttl', status: 'canceled' }
}

/**
 * @returns {{ action: 'cancel' | 'keep' | 'skip', reason: string, status?: string }}
 */
export function decideAbandonedCheckout({ trip, session, payments, failed = false } = {}) {
  const kind = session?.metadata?.kind
  if (kind && kind !== 'airport_deposit') return { action: 'skip', reason: 'not_airport_deposit' }
  const tripId = session?.metadata?.tripId || trip?.id
  if (!tripId || !trip) return { action: 'skip', reason: 'missing_trip' }

  const state = sessionPaymentState(session)
  if (depositSucceeded(payments) || state === 'paid') {
    return { action: 'keep', reason: 'paid', status: trip.status }
  }

  const bound = boundSessionId(trip)
  const sessionId = typeof session?.id === 'string' ? session.id : ''
  if (bound && sessionId && bound !== sessionId) {
    return { action: 'skip', reason: 'stale_session', status: trip.status }
  }

  if (!failed && state === 'async_pending') {
    return { action: 'skip', reason: 'async_pending', status: trip.status }
  }
  if (trip.driver_id) return { action: 'skip', reason: 'driver_assigned', status: trip.status }
  if (!UNPAID_CHECKOUT_STATUSES.includes(trip.status)) {
    return { action: 'skip', reason: 'not_in_pool', status: trip.status }
  }
  return { action: 'cancel', reason: 'unpaid_checkout', status: 'canceled' }
}

export function liveStatusAfterPaidDeposit(trip, session, { depositPaid = false } = {}) {
  if (!trip) return { action: 'skip', reason: 'missing_trip' }
  if (session?.metadata?.kind && session.metadata.kind !== 'airport_deposit') {
    return { action: 'skip', reason: 'not_airport_deposit', status: trip.status }
  }
  if (sessionPaymentState(session) !== 'paid' && !depositPaid) {
    return { action: 'skip', reason: 'not_paid', status: trip.status }
  }
  if (LIVE_MATCH_STATUSES.includes(trip.status)) {
    return { action: 'keep', reason: 'already_live', status: trip.status }
  }
  if (trip.status !== 'canceled') return { action: 'keep', reason: 'left_closed', status: trip.status }
  if (trip.driver_id) return { action: 'keep', reason: 'driver_assigned', status: trip.status }
  const abandoned = trip.metadata?.checkout_abandoned
  if (!abandoned || typeof abandoned !== 'object') {
    return { action: 'keep', reason: 'not_checkout_abandon', status: trip.status }
  }
  const next = trip.scheduled_for ? 'scheduled' : 'searching'
  return { action: 'restore', reason: 'deposit_paid', status: next }
}

async function loadTrip(sb, tripId) {
  const { data, error } = await sb
    .from('trips')
    .select('id, status, rider_id, driver_id, scheduled_for, metadata, canceled_at, created_at, deposit_cents, rider_note, hold_expire_claimed_at')
    .eq('id', tripId)
    .maybeSingle()
  if (error) return { error }
  return { trip: data || null }
}

async function loadDeposits(sb, tripId) {
  const { data, error } = await sb
    .from('payments')
    .select('id, kind, status, amount_cents')
    .eq('trip_id', tripId)
    .in('kind', ['deposit', 'airport_deposit'])
  if (error) return { error }
  return { payments: data || [] }
}

function metaObject(trip) {
  return trip?.metadata && typeof trip.metadata === 'object' ? trip.metadata : {}
}

async function writeCanceled(sb, trip, session, { reason, source }) {
  const canceledAt = new Date().toISOString()
  const patch = {
    checkout_abandoned: {
      session_id: session?.id || null,
      reason,
      source,
      at: canceledAt,
    },
  }
  // Conditional update: only the sweep that still sees a live hold writes
  // the cancel and, below, the trip_events row.
  const { data, error } = await sb.rpc('merge_trip_metadata', {
    p_trip_id: trip.id,
    p_patch: patch,
    p_expected_statuses: UNPAID_CHECKOUT_STATUSES,
    p_new_status: 'canceled',
    p_canceled_at: canceledAt,
    p_clear_claim: true,
    p_require_unassigned: true,
    p_require_unabandoned: true,
  })
  if (error) return { released: false, reason: 'update_failed', error: error.message }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || !row.id) return { released: false, reason: 'not_in_pool', status: trip.status }
  const { error: eventErr } = await sb.from('trip_events').insert({
    trip_id: trip.id,
    kind: 'canceled',
    payload: {
      reason,
      source,
      checkout_session: session?.id || null,
      canceled_at: canceledAt,
    },
  })
  return {
    released: true,
    status: 'canceled',
    tripId: trip.id,
    eventError: eventErr?.message || null,
  }
}

export async function restoreLiveTripAfterDeposit(sb, session, { depositPaid = false } = {}) {
  const tripId = session?.metadata?.tripId
  if (!tripId) return { restored: false, reason: 'missing_trip' }
  if (session?.metadata?.kind && session.metadata.kind !== 'airport_deposit') {
    return { restored: false, reason: 'not_airport_deposit' }
  }
  if (sessionPaymentState(session) !== 'paid' && !depositPaid) return { restored: false, reason: 'not_paid' }
  const loaded = await loadTrip(sb, tripId)
  if (loaded.error) return { restored: false, reason: 'trip_unreadable', error: loaded.error.message }
  const trip = loaded.trip
  const decision = liveStatusAfterPaidDeposit(trip, session, { depositPaid })
  if (!decision || decision.action !== 'restore') {
    // Still stamp checkout_deposit on an already-live paid trip so the driver
    // match gate can see deposit paid without joining payments.
    if (trip && decision?.reason === 'already_live') {
      const meta = { ...metaObject(trip) }
      if (!meta.checkout_deposit || typeof meta.checkout_deposit !== 'object') {
        const patch = {
          checkout_deposit: { session_id: session?.id || null, at: new Date().toISOString() },
        }
        const { error: stampErr } = await sb.rpc('merge_trip_metadata', {
          p_trip_id: tripId,
          p_patch: patch,
        })
        if (stampErr) {
          return {
            restored: false,
            reason: decision?.reason || 'already_live',
            status: trip?.status || null,
            stampError: stampErr.message,
          }
        }
      }
    }
    return { restored: false, reason: decision?.reason || 'already_live', status: trip?.status || null }
  }
  const meta = { ...metaObject(trip) }
  delete meta.checkout_abandoned
  meta.checkout_deposit = { session_id: session.id || null, at: new Date().toISOString() }
  const { data, error } = await sb
    .from('trips')
    .update({ status: decision.status, canceled_at: null, metadata: meta })
    .eq('id', tripId)
    .eq('status', 'canceled')
    .is('driver_id', null)
    .select('id, status')
    .maybeSingle()
  if (error) return { restored: false, reason: 'update_failed', error: error.message }
  if (!data) return { restored: false, reason: 'not_canceled', status: trip.status }
  const { error: eventErr } = await sb.from('trip_events').insert({
    trip_id: tripId,
    kind: decision.status,
    payload: {
      reason: 'deposit_paid',
      source: 'stripe_webhook',
      checkout_session: session.id || null,
    },
  })
  return {
    restored: true,
    status: decision.status,
    tripId,
    eventError: eventErr?.message || null,
  }
}

async function keepPaid(sb, session, trip) {
  const restored = await restoreLiveTripAfterDeposit(sb, session, { depositPaid: true })
  return {
    released: false,
    reason: 'paid',
    status: restored.status || trip?.status || null,
    restored: Boolean(restored.restored),
  }
}

export async function releaseUnpaidCheckoutTrip(sb, session, {
  reason = 'checkout_abandoned',
  source = 'stripe_webhook',
  failed = false,
  expireSession,
  retrieveSession,
} = {}) {
  const tripId = session?.metadata?.tripId
  if (!tripId) return { released: false, reason: 'missing_trip' }
  if (session?.metadata?.kind && session.metadata.kind !== 'airport_deposit') {
    return { released: false, reason: 'not_airport_deposit' }
  }

  let active = session
  let loaded = await loadTrip(sb, tripId)
  if (loaded.error) return { released: false, reason: 'trip_unreadable', error: loaded.error.message }
  let trip = loaded.trip
  let deposits = await loadDeposits(sb, tripId)
  if (deposits.error) return { released: false, reason: 'payments_unreadable', error: deposits.error.message }

  const refresh = async () => {
    loaded = await loadTrip(sb, tripId)
    if (loaded.error) return loaded.error
    trip = loaded.trip
    deposits = await loadDeposits(sb, tripId)
    if (deposits.error) return deposits.error
    return null
  }

  let decision = decideAbandonedCheckout({ trip, session: active, payments: deposits.payments, failed })
  if (decision.action === 'keep' && decision.reason === 'paid') return keepPaid(sb, active, trip)

  if (String(active?.status || '') === 'open' && decision.action === 'cancel') {
    if (typeof expireSession !== 'function') {
      return { released: false, reason: 'still_open', status: trip?.status || null }
    }
    const claim = await claimStripeExpire(sb, trip)
    if (!claim.won) {
      return {
        released: false,
        reason: claim.reason,
        status: claim.status || trip?.status || null,
        ...(claim.error ? { error: claim.error } : {}),
      }
    }
    try {
      const expired = await expireSession(active.id)
      active = {
        ...active,
        ...(expired && typeof expired === 'object' ? expired : {}),
        metadata: active.metadata,
        status: expired?.status || 'expired',
      }
    } catch (err) {
      if (typeof retrieveSession === 'function') {
        try {
          const latest = await retrieveSession(active.id)
          if (latest) active = latest
        } catch {
          /* keep the session we already evaluated */
        }
      }
      const readErr = await refresh()
      if (readErr) {
        await releaseExpireClaim(sb, tripId)
        return { released: false, reason: 'trip_unreadable', error: readErr.message }
      }
      decision = decideAbandonedCheckout({ trip, session: active, payments: deposits.payments, failed })
      if (decision.action === 'keep' && decision.reason === 'paid') {
        const kept = await keepPaid(sb, active, trip)
        await releaseExpireClaim(sb, tripId)
        return kept
      }
      await releaseExpireClaim(sb, tripId)
      return {
        released: false,
        reason: 'still_open',
        status: trip?.status || null,
        error: err?.message || 'expire_failed',
      }
    }
    const readErr = await refresh()
    if (readErr) {
      await releaseExpireClaim(sb, tripId)
      return { released: false, reason: 'trip_unreadable', error: readErr.message }
    }
    decision = decideAbandonedCheckout({ trip, session: active, payments: deposits.payments, failed })
    if (decision.action === 'keep' && decision.reason === 'paid') {
      const kept = await keepPaid(sb, active, trip)
      await releaseExpireClaim(sb, tripId)
      return kept
    }
  }

  if (decision.action !== 'cancel') {
    return { released: false, reason: decision.reason, status: decision.status || trip?.status || null }
  }
  const written = await writeCanceled(sb, trip, active, { reason, source })
  if (!written.released) await releaseExpireClaim(sb, tripId)
  return written
}

export async function releaseFromCheckoutEvent(sb, event, extras = {}) {
  const session = event?.data?.object
  if (event?.type === 'checkout.session.expired') {
    return releaseUnpaidCheckoutTrip(sb, session, {
      ...extras,
      reason: 'checkout_expired',
      source: 'stripe_webhook',
    })
  }
  if (event?.type === 'checkout.session.async_payment_failed') {
    return releaseUnpaidCheckoutTrip(sb, session, {
      ...extras,
      reason: 'checkout_async_failed',
      source: 'stripe_webhook',
      failed: true,
    })
  }
  return { released: false, reason: 'ignored' }
}

/** Stripe session create failed. The trip never opened a payable Checkout. */
export async function cancelUnopenedCheckoutTrip(sb, tripId, { reason = 'checkout_create_failed', source = 'checkout_create' } = {}) {
  if (!tripId) return { released: false, reason: 'missing_trip' }
  const deposits = await loadDeposits(sb, tripId)
  if (deposits.error) return { released: false, reason: 'payments_unreadable', error: deposits.error.message }
  if (depositSucceeded(deposits.payments)) return { released: false, reason: 'paid' }
  const loaded = await loadTrip(sb, tripId)
  if (loaded.error) return { released: false, reason: 'trip_unreadable', error: loaded.error.message }
  if (!loaded.trip) return { released: false, reason: 'missing_trip' }
  return writeCanceled(sb, loaded.trip, null, { reason, source })
}

export async function rememberCheckoutSession(sb, tripId, sessionId, { createdAt } = {}) {
  if (!tripId || !sessionId) return { ok: false, error: 'missing_session' }
  const stamped = typeof createdAt === 'string' && createdAt ? createdAt : new Date().toISOString()
  const patch = {
    stripe_checkout_session_id: sessionId,
    stripe_checkout_created_at: stamped,
  }
  const { data, error } = await sb.rpc('merge_trip_metadata', {
    p_trip_id: tripId,
    p_patch: patch,
  })
  if (error) return { ok: false, error: error.message }
  const row = Array.isArray(data) ? data[0] : data
  if (!row || !row.id) return { ok: false, error: 'missing_trip' }
  return { ok: true }
}

const STRIPE_TERMINAL_REASONS = new Set([
  'paid',
  'not_in_pool',
  'driver_assigned',
  'stale_session',
  'async_pending',
  'not_airport_deposit',
  'missing_trip',
])

/** A crashed claim can be taken over on a later cron tick. */
const HOLD_EXPIRE_CLAIM_MS = 2 * 60 * 1000

function claimIsFresh(claim, now) {
  if (!claim) return false
  const at = typeof claim === 'object' ? parsedMs(claim.at) : parsedMs(claim)
  if (at == null) return false
  return now - at < HOLD_EXPIRE_CLAIM_MS
}

/**
 * One overlapping sweep expires an open Checkout session. The update matches
 * only while checkout_abandoned is unset and no fresh claim is stored.
 */
async function claimStripeExpire(sb, trip, now = Date.now()) {
  const loaded = await loadTrip(sb, trip?.id)
  if (loaded.error) return { won: false, reason: 'trip_unreadable', error: loaded.error.message }
  if (!loaded.trip) return { won: false, reason: 'missing_trip' }
  const fresh = loaded.trip
  const meta = metaObject(fresh)
  if (meta.checkout_abandoned && typeof meta.checkout_abandoned === 'object') {
    return { won: false, reason: 'already_abandoned', status: fresh.status }
  }
  if (fresh.driver_id || !UNPAID_CHECKOUT_STATUSES.includes(fresh.status)) {
    return { won: false, reason: 'not_in_pool', status: fresh.status }
  }
  const existingClaim = fresh.hold_expire_claimed_at || meta.hold_expire_claim
  if (claimIsFresh(existingClaim, now)) {
    return { won: false, reason: 'expire_in_progress', status: fresh.status }
  }
  const claimIso = new Date(now).toISOString()
  const staleCutoff = new Date(now - HOLD_EXPIRE_CLAIM_MS).toISOString()
  const { data, error } = await sb
    .from('trips')
    .update({ hold_expire_claimed_at: claimIso })
    .eq('id', fresh.id)
    .in('status', UNPAID_CHECKOUT_STATUSES)
    .is('driver_id', null)
    .is('metadata->>checkout_abandoned', null)
    .or(`hold_expire_claimed_at.is.null,hold_expire_claimed_at.lt.${staleCutoff}`)
    .select('id')
    .maybeSingle()
  if (error) return { won: false, reason: 'claim_failed', error: error.message }
  if (!data) return { won: false, reason: 'expire_in_progress', status: fresh.status }
  return { won: true, status: fresh.status }
}

async function releaseExpireClaim(sb, tripId) {
  if (!tripId) return
  await sb
    .from('trips')
    .update({ hold_expire_claimed_at: null })
    .eq('id', tripId)
}

async function cancelExpiredHold(sb, trip, sessionId, { now, ttlMs }) {
  const deposits = await loadDeposits(sb, trip.id)
  if (deposits.error) {
    return { released: false, reason: 'payments_unreadable', error: deposits.error.message, tripId: trip.id }
  }
  const loaded = await loadTrip(sb, trip.id)
  if (loaded.error) return { released: false, reason: 'trip_unreadable', error: loaded.error.message, tripId: trip.id }
  if (!loaded.trip) return { released: false, reason: 'missing_trip', tripId: trip.id }
  const fresh = {
    ...trip,
    ...loaded.trip,
    deposit_cents: loaded.trip.deposit_cents ?? trip.deposit_cents,
    rider_note: loaded.trip.rider_note ?? trip.rider_note,
    created_at: loaded.trip.created_at || trip.created_at,
    hold_expire_claimed_at: loaded.trip.hold_expire_claimed_at ?? trip.hold_expire_claimed_at,
  }
  const decision = decideUnpaidAirportHoldTtl({
    trip: fresh,
    payments: deposits.payments,
    now,
    ttlMs,
  })
  if (decision.action !== 'cancel') {
    return { released: false, reason: decision.reason, status: decision.status || fresh.status, tripId: trip.id }
  }
  const written = await writeCanceled(sb, fresh, sessionId ? { id: sessionId } : null, {
    reason: 'unpaid_hold_ttl',
    source: 'hold_ttl',
  })
  return { ...written, tripId: trip.id }
}

function holdSweepError(row) {
  if (!row || row.released || row.wouldExpire) return false
  if (row.error) return true
  return row.reason === 'error'
    || row.reason === 'payments_unreadable'
    || row.reason === 'trip_unreadable'
    || row.reason === 'update_failed'
    || row.reason === 'claim_failed'
    || row.reason === 'list_failed'
}

function summarizeHoldSweep(results, { dryRun = false } = {}) {
  const expired = results.filter((row) => row.released).length
  const errors = results.filter((row) => holdSweepError(row)).length
  const wouldExpire = results.filter((row) => row.wouldExpire).length
  const skipped = Math.max(0, results.length - expired - errors - wouldExpire)
  return {
    ok: true,
    dryRun: Boolean(dryRun),
    scanned: results.length,
    expired,
    released: expired,
    skipped,
    errors,
    wouldExpire,
    results,
  }
}

function stripeStopsHoldSweep(released) {
  return Boolean(
    released?.released
    || released?.error
    || released?.reason === 'expire_in_progress'
    || released?.reason === 'already_abandoned'
    || STRIPE_TERMINAL_REASONS.has(released?.reason),
  )
}

/** Cancel one unpaid airport hold that has aged past the TTL. Safe to retry. */
export async function releaseExpiredUnpaidAirportHold(sb, trip, {
  now = Date.now(),
  ttlMs = UNPAID_AIRPORT_HOLD_TTL_MS,
  payments,
  expireSession,
  retrieveSession,
  dryRun = false,
} = {}) {
  if (!trip?.id) return { released: false, reason: 'missing_trip' }

  let knownPayments = payments
  if (!knownPayments) {
    const preliminary = decideUnpaidAirportHoldTtl({ trip, payments: [], now, ttlMs })
    if (preliminary.action !== 'cancel') {
      return {
        released: false,
        reason: preliminary.reason,
        status: preliminary.status || trip.status,
        tripId: trip.id,
      }
    }
    const deposits = await loadDeposits(sb, trip.id)
    if (deposits.error) {
      return { released: false, reason: 'payments_unreadable', error: deposits.error.message, tripId: trip.id }
    }
    knownPayments = deposits.payments
  }

  const decision = decideUnpaidAirportHoldTtl({ trip, payments: knownPayments, now, ttlMs })
  if (decision.action !== 'cancel') {
    return { released: false, reason: decision.reason, status: decision.status || trip.status, tripId: trip.id }
  }

  const sessionId = boundSessionId(trip)
  if (dryRun) {
    if (sessionId && typeof retrieveSession === 'function') {
      try {
        const session = await retrieveSession(sessionId)
        if (session && typeof session === 'object') {
          const kind = session.metadata?.kind
          const sessionTripId = session.metadata?.tripId
          const sameDeposit = (!kind || kind === 'airport_deposit') && (!sessionTripId || sessionTripId === trip.id)
          if (sameDeposit) {
            const state = sessionPaymentState(session)
            if (state === 'paid' || state === 'async_pending') {
              return {
                released: false,
                reason: state === 'paid' ? 'paid' : 'async_pending',
                status: trip.status,
                tripId: trip.id,
                dryRun: true,
              }
            }
          }
        }
      } catch {
        /* Dry run reports the database decision and does not write. */
      }
    }
    return {
      released: false,
      wouldExpire: true,
      dryRun: true,
      reason: 'unpaid_hold_ttl',
      status: trip.status,
      tripId: trip.id,
    }
  }

  if (sessionId && typeof retrieveSession === 'function') {
    try {
      const session = await retrieveSession(sessionId)
      if (session && typeof session === 'object') {
        const kind = session.metadata?.kind
        const sessionTripId = session.metadata?.tripId
        const sameDeposit = (!kind || kind === 'airport_deposit') && (!sessionTripId || sessionTripId === trip.id)
        if (sameDeposit) {
          const released = await releaseUnpaidCheckoutTrip(sb, {
            ...session,
            metadata: {
              ...(session.metadata || {}),
              kind: 'airport_deposit',
              tripId: trip.id,
            },
          }, {
            reason: 'unpaid_hold_ttl',
            source: 'hold_ttl',
            expireSession,
            retrieveSession,
          })
          if (stripeStopsHoldSweep(released)) return { ...released, tripId: trip.id }
        }
      }
    } catch {
      /* Stripe could not be read. The database row still leaves the pool. */
    }
  }

  return cancelExpiredHold(sb, trip, sessionId, { now, ttlMs })
}

/**
 * Cancel unpaid airport-deposit searching, offered, and scheduled holds whose
 * created_at is at least ttlMs ago. A newer stripe_checkout_created_at keeps
 * the row. Paid deposits and non-airport trips are not updated. limit is
 * capped at 40. dryRun reports wouldExpire and does not write.
 */
export async function releaseExpiredUnpaidAirportHolds(sb, {
  now = Date.now(),
  ttlMs = UNPAID_AIRPORT_HOLD_TTL_MS,
  limit = 40,
  expireSession,
  retrieveSession,
  dryRun = false,
} = {}) {
  const batchSize = Math.min(40, Math.max(1, Number(limit) || 40))
  const cutoff = new Date(now - ttlMs).toISOString()
  const listed = await sb
    .from('trips')
    .select('id, status, rider_id, driver_id, scheduled_for, metadata, canceled_at, created_at, deposit_cents, rider_note, hold_expire_claimed_at')
    .in('status', UNPAID_CHECKOUT_STATUSES)
    .is('driver_id', null)
    .gt('deposit_cents', 0)
    .lte('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(batchSize)
  if (listed.error) {
    return {
      ok: false,
      reason: 'list_failed',
      error: listed.error.message,
      dryRun: Boolean(dryRun),
      scanned: 0,
      expired: 0,
      released: 0,
      skipped: 0,
      errors: 1,
      wouldExpire: 0,
      results: [],
    }
  }
  const results = []
  for (const trip of listed.data || []) {
    try {
      results.push(await releaseExpiredUnpaidAirportHold(sb, trip, {
        now,
        ttlMs,
        expireSession: dryRun ? undefined : expireSession,
        retrieveSession,
        dryRun,
      }))
    } catch (err) {
      results.push({
        released: false,
        reason: 'error',
        error: err?.message || 'hold_failed',
        tripId: trip?.id || null,
      })
    }
  }
  return summarizeHoldSweep(results, { dryRun })
}
