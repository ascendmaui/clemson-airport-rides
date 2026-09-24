/**
 * Airport Checkout can insert a searching or scheduled trip before Stripe is paid.
 * A canceled, expired, or unfinished session must take that unpaid trip out of the
 * match pool. A paid deposit leaves the trip in searching, offered, requested, or
 * scheduled. Replays are safe: a recorded deposit or a paid session is never canceled.
 */

export const UNPAID_CHECKOUT_STATUSES = ['searching', 'offered', 'scheduled']

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
    .select('id, status, rider_id, driver_id, scheduled_for, metadata, canceled_at')
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
  const nextMeta = {
    ...metaObject(trip),
    checkout_abandoned: {
      session_id: session?.id || null,
      reason,
      source,
      at: canceledAt,
    },
  }
  const { data, error } = await sb
    .from('trips')
    .update({ status: 'canceled', canceled_at: canceledAt, metadata: nextMeta })
    .eq('id', trip.id)
    .in('status', UNPAID_CHECKOUT_STATUSES)
    .is('driver_id', null)
    .select('id, status')
    .maybeSingle()
  if (error) return { released: false, reason: 'update_failed', error: error.message }
  if (!data) return { released: false, reason: 'not_in_pool', status: trip.status }
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
      if (readErr) return { released: false, reason: 'trip_unreadable', error: readErr.message }
      decision = decideAbandonedCheckout({ trip, session: active, payments: deposits.payments, failed })
      if (decision.action === 'keep' && decision.reason === 'paid') return keepPaid(sb, active, trip)
      return {
        released: false,
        reason: 'still_open',
        status: trip?.status || null,
        error: err?.message || 'expire_failed',
      }
    }
    const readErr = await refresh()
    if (readErr) return { released: false, reason: 'trip_unreadable', error: readErr.message }
    decision = decideAbandonedCheckout({ trip, session: active, payments: deposits.payments, failed })
    if (decision.action === 'keep' && decision.reason === 'paid') return keepPaid(sb, active, trip)
  }

  if (decision.action !== 'cancel') {
    return { released: false, reason: decision.reason, status: decision.status || trip?.status || null }
  }
  return writeCanceled(sb, trip, active, { reason, source })
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

export async function rememberCheckoutSession(sb, tripId, sessionId) {
  if (!tripId || !sessionId) return { ok: false, error: 'missing_session' }
  const loaded = await loadTrip(sb, tripId)
  if (loaded.error || !loaded.trip) return { ok: false, error: loaded.error?.message || 'missing_trip' }
  const metadata = { ...metaObject(loaded.trip), stripe_checkout_session_id: sessionId }
  const { error } = await sb.from('trips').update({ metadata }).eq('id', tripId)
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}
