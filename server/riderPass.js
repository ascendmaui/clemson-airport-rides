/**
 * Favorite drivers and the frequent-rider pass.
 * Discount and preferred-driver priority are read from the database.
 * Client flags are not pricing or matching inputs.
 */
import { favoriteIdsForMatching } from '../shared/riderFavorites.js'
import {
  TIGER_PASS_DISCOUNT_BPS,
  TIGER_PASS_NAME,
  TIGER_PASS_PERIOD_MS,
  TIGER_PASS_PRICE_CENTS,
  TIGER_PASS_PRODUCT_ID,
  applyTigerPassDiscount,
  assertPreferredCarTypes,
  filterPreferredCarTypes,
  subscriptionIsActive,
  tigerPassCarTypes,
  tigerPassCopy,
} from '../shared/tigerPass.js'
import { WEB_ORIGIN } from '../shared/productLinks.js'

export { applyTigerPassDiscount }

const EMPTY_PREFS = {
  favoriteIds: [],
  preferredIds: [],
  carTypes: [],
  active: false,
  discountBps: 0,
  row: null,
}

function periodEndFromUnix(seconds, now) {
  const n = Number(seconds)
  if (Number.isFinite(n) && n > 0) return new Date(n * 1000).toISOString()
  return new Date(now.getTime() + TIGER_PASS_PERIOD_MS).toISOString()
}

export function passStatusPayload(row, favoriteIds, now = new Date()) {
  const active = subscriptionIsActive(row, now)
  const copy = tigerPassCopy()
  return {
    productId: TIGER_PASS_PRODUCT_ID,
    name: copy.name,
    priceCents: TIGER_PASS_PRICE_CENTS,
    discountBps: TIGER_PASS_DISCOUNT_BPS,
    discountPct: TIGER_PASS_DISCOUNT_BPS / 100,
    active,
    status: row?.status || 'inactive',
    currentPeriodEnd: row?.current_period_end || null,
    cancelAtPeriodEnd: Boolean(row?.cancel_at_period_end),
    preferredDriverIds: favoriteIdsForMatching(row?.preferred_driver_ids),
    preferredCarTypes: filterPreferredCarTypes(row?.preferred_car_types),
    favoriteDriverIds: favoriteIdsForMatching(favoriteIds),
    carTypes: tigerPassCarTypes(),
    summary: copy.summary,
    priceLabel: copy.priceLabel,
    demoNote: copy.demoNote,
    renameHook: 'TIGER_PASS_NAME',
  }
}

async function readProfileFavorites(sb, riderId) {
  const res = await sb.from('profiles').select('favorite_driver_ids').eq('id', riderId).maybeSingle()
  if (res?.error) return []
  return favoriteIdsForMatching(res?.data?.favorite_driver_ids)
}

async function readPassRow(sb, riderId) {
  const res = await sb.from('rider_subscriptions').select('*').eq('rider_id', riderId).maybeSingle()
  if (res?.error) return null
  return res?.data || null
}

export async function loadRiderMatchPreferences(sb, riderId, now = new Date()) {
  if (!sb || !riderId) return { ...EMPTY_PREFS }
  try {
    const favoriteIds = await readProfileFavorites(sb, riderId)
    const row = await readPassRow(sb, riderId)
    const active = subscriptionIsActive(row, now)
    const preferredIds = active ? favoriteIdsForMatching(row?.preferred_driver_ids) : []
    return {
      favoriteIds,
      preferredIds,
      carTypes: filterPreferredCarTypes(row?.preferred_car_types),
      active,
      discountBps: active ? Math.max(0, Math.round(Number(row?.discount_bps) || TIGER_PASS_DISCOUNT_BPS)) : 0,
      row,
    }
  } catch {
    return { ...EMPTY_PREFS }
  }
}

export async function tigerPassBpsForRider(sb, riderId, now = new Date()) {
  const prefs = await loadRiderMatchPreferences(sb, riderId, now)
  return prefs.discountBps
}

async function writeFavorites(sb, riderId, ids) {
  const next = favoriteIdsForMatching(ids)
  const updated = await sb
    .from('profiles')
    .update({ favorite_driver_ids: next, updated_at: new Date().toISOString() })
    .eq('id', riderId)
  if (updated?.error) {
    const error = new Error(updated.error.message || 'Could not save favorite drivers')
    error.status = 500
    throw error
  }
  return next
}

async function writePassPatch(sb, riderId, patch) {
  const existing = await readPassRow(sb, riderId)
  const row = {
    status: existing?.status || 'inactive',
    discount_bps: existing?.discount_bps ?? TIGER_PASS_DISCOUNT_BPS,
    preferred_driver_ids: favoriteIdsForMatching(existing?.preferred_driver_ids),
    preferred_car_types: filterPreferredCarTypes(existing?.preferred_car_types),
    stripe_customer_id: existing?.stripe_customer_id || null,
    stripe_subscription_id: existing?.stripe_subscription_id || null,
    stripe_checkout_session_id: existing?.stripe_checkout_session_id || null,
    current_period_end: existing?.current_period_end || null,
    cancel_at_period_end: Boolean(existing?.cancel_at_period_end),
    created_at: existing?.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...patch,
    rider_id: riderId,
    product_id: TIGER_PASS_PRODUCT_ID,
  }
  const saved = await sb.from('rider_subscriptions').upsert(row, { onConflict: 'rider_id' }).select('*').maybeSingle()
  if (saved?.error) {
    const error = new Error(saved.error.message || 'Could not save the pass')
    error.status = /schema cache|does not exist|column/i.test(saved.error.message || '') ? 503 : 500
    error.code = 'tiger_pass_unavailable'
    throw error
  }
  return saved?.data || row
}

export async function loadRiderPass(sb, riderId, now = new Date()) {
  const favoriteIds = await readProfileFavorites(sb, riderId).catch(() => [])
  const row = await readPassRow(sb, riderId).catch(() => null)
  return passStatusPayload(row, favoriteIds, now)
}

export async function saveFavoriteDrivers(sb, riderId, driverIds, now = new Date()) {
  const incoming = Array.isArray(driverIds) ? driverIds : []
  const droppedPreview = incoming.some((id) => typeof id === 'string' && id.trim() && !favoriteIdsForMatching([id]).length && /demo-|sim-busy-/i.test(id))
  const next = await writeFavorites(sb, riderId, incoming)
  const row = await readPassRow(sb, riderId)
  let savedRow = row
  if (row) {
    const preferred = favoriteIdsForMatching(row.preferred_driver_ids).filter((id) => next.includes(id))
    if (preferred.length !== favoriteIdsForMatching(row.preferred_driver_ids).length) {
      savedRow = await writePassPatch(sb, riderId, { preferred_driver_ids: preferred })
    }
  }
  return {
    ...passStatusPayload(savedRow, next, now),
    demoDriversIgnored: droppedPreview,
  }
}

export async function savePassPreferences(sb, riderId, body, now = new Date()) {
  const carTypes = assertPreferredCarTypes(body?.preferredCarTypes ?? body?.preferred_car_types ?? [])
  const requested = body?.preferredDriverIds ?? body?.preferred_driver_ids ?? []
  const incoming = Array.isArray(requested) ? requested : []
  const droppedPreview = incoming.some((id) => typeof id === 'string' && id.trim() && !favoriteIdsForMatching([id]).length && /demo-|sim-busy-/i.test(id))
  const preferred = favoriteIdsForMatching(incoming)
  const existingFavorites = await readProfileFavorites(sb, riderId)
  const favoriteIds = favoriteIdsForMatching([...existingFavorites, ...preferred])
  await writeFavorites(sb, riderId, favoriteIds)
  const row = await writePassPatch(sb, riderId, {
    preferred_driver_ids: preferred,
    preferred_car_types: carTypes,
  })
  return {
    ...passStatusPayload(row, favoriteIds, now),
    demoDriversIgnored: droppedPreview,
  }
}

function checkoutOrigin(body) {
  for (const raw of [body?.origin, body?.successUrl]) {
    if (!raw || typeof raw !== 'string') continue
    try {
      const url = new URL(raw)
      if (url.protocol === 'https:' || url.protocol === 'http:') return url.origin
    } catch {
      /* next candidate */
    }
  }
  return process.env.VITE_APP_URL || WEB_ORIGIN
}

export async function startTigerPassCheckout(sb, user, body, { stripe, ensureStripeCustomer } = {}) {
  if (!stripe?.checkout?.sessions?.create) {
    const error = new Error('STRIPE_SECRET_KEY is not configured.')
    error.status = 503
    error.code = 'payments_unavailable'
    throw error
  }
  const existingPass = await readPassRow(sb, user.id)
  if (subscriptionIsActive(existingPass) || existingPass?.status === 'past_due') {
    const error = new Error(existingPass?.status === 'past_due'
      ? 'This pass is past due. A second subscription was not started.'
      : 'This pass is already active.')
    error.status = 409
    error.code = 'tiger_pass_already_subscribed'
    throw error
  }
  const profileRes = await sb
    .from('profiles')
    .select('id, email, full_name, stripe_customer_id')
    .eq('id', user.id)
    .maybeSingle()
  let customerId = null
  if (profileRes?.data && ensureStripeCustomer) {
    try {
      customerId = await ensureStripeCustomer(stripe, sb, profileRes.data)
    } catch {
      customerId = profileRes.data.stripe_customer_id || null
    }
  }
  const origin = checkoutOrigin(body)
  const successUrl = typeof body?.successUrl === 'string' && body.successUrl.includes('{CHECKOUT_SESSION_ID}')
    ? body.successUrl
    : `${origin}/#/account?tab=billing&tigerPass=1&session_id={CHECKOUT_SESSION_ID}`
  const cancelUrl = typeof body?.cancelUrl === 'string' && body.cancelUrl
    ? body.cancelUrl
    : `${origin}/#/account?tab=billing&tigerPass=0`
  const copy = tigerPassCopy()
  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId || undefined,
    customer_email: customerId ? undefined : (profileRes?.data?.email || user.email || undefined),
    success_url: successUrl,
    cancel_url: cancelUrl,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: TIGER_PASS_PRICE_CENTS,
        recurring: { interval: 'month' },
        product_data: {
          name: copy.name,
          description: copy.summary,
        },
      },
    }],
    metadata: {
      kind: TIGER_PASS_PRODUCT_ID,
      profile_id: user.id,
      product_id: TIGER_PASS_PRODUCT_ID,
      discount_bps: String(TIGER_PASS_DISCOUNT_BPS),
    },
    subscription_data: {
      metadata: {
        kind: TIGER_PASS_PRODUCT_ID,
        profile_id: user.id,
        product_id: TIGER_PASS_PRODUCT_ID,
      },
    },
  })
  return { id: session.id, url: session.url, name: copy.name, priceCents: TIGER_PASS_PRICE_CENTS }
}

export async function activateTigerPass(sb, {
  riderId,
  stripeCustomerId = null,
  stripeSubscriptionId = null,
  stripeCheckoutSessionId = null,
  periodEnd = null,
  cancelAtPeriodEnd = false,
  now = new Date(),
} = {}) {
  if (!riderId) return { skipped: true, reason: 'missing_metadata' }
  if (!sb) return { skipped: true, reason: 'no_service_role' }
  const existing = await readPassRow(sb, riderId)
  const row = await writePassPatch(sb, riderId, {
    status: 'active',
    discount_bps: TIGER_PASS_DISCOUNT_BPS,
    stripe_customer_id: stripeCustomerId || existing?.stripe_customer_id || null,
    stripe_subscription_id: stripeSubscriptionId || existing?.stripe_subscription_id || null,
    stripe_checkout_session_id: stripeCheckoutSessionId || existing?.stripe_checkout_session_id || null,
    current_period_end: periodEnd || existing?.current_period_end || periodEndFromUnix(null, now),
    cancel_at_period_end: Boolean(cancelAtPeriodEnd),
    preferred_driver_ids: favoriteIdsForMatching(existing?.preferred_driver_ids),
    preferred_car_types: filterPreferredCarTypes(existing?.preferred_car_types),
  })
  return { ok: true, riderId, status: row.status, name: TIGER_PASS_NAME }
}

export async function activateTigerPassFromCheckout(sb, session, now = new Date(), stripe = null) {
  const meta = session?.metadata || {}
  if (meta.kind !== TIGER_PASS_PRODUCT_ID) return { skipped: true, reason: 'not_tiger_pass' }
  const riderId = meta.profile_id
  if (!riderId) return { skipped: true, reason: 'missing_metadata' }
  if (!sb) return { skipped: true, reason: 'no_service_role' }
  const paid = session.payment_status
  if (paid && paid !== 'paid' && paid !== 'no_payment_required') {
    return { skipped: true, reason: 'unpaid' }
  }
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id || null
  let periodEndUnix = session.current_period_end
  if (!periodEndUnix && subscriptionId && stripe?.subscriptions?.retrieve) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      periodEndUnix = subscription?.current_period_end || null
    } catch {
      periodEndUnix = null
    }
  }
  const periodEnd = periodEndUnix
    ? periodEndFromUnix(periodEndUnix, now)
    : periodEndFromUnix(null, now)
  return activateTigerPass(sb, {
    riderId,
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id || null,
    stripeSubscriptionId: subscriptionId,
    stripeCheckoutSessionId: session.id || null,
    periodEnd,
    now,
  })
}

export async function confirmTigerPassCheckout(sb, user, sessionId, { stripe, now = new Date() } = {}) {
  if (!sessionId) {
    const error = new Error('Checkout session is missing')
    error.status = 400
    throw error
  }
  if (!stripe?.checkout?.sessions?.retrieve) {
    const error = new Error('STRIPE_SECRET_KEY is not configured.')
    error.status = 503
    error.code = 'payments_unavailable'
    throw error
  }
  const session = await stripe.checkout.sessions.retrieve(sessionId)
  if (session?.metadata?.profile_id && session.metadata.profile_id !== user.id) {
    const error = new Error('That checkout belongs to another rider')
    error.status = 403
    throw error
  }
  if (session?.metadata?.kind !== TIGER_PASS_PRODUCT_ID) {
    const error = new Error('That checkout is not a frequent-rider pass')
    error.status = 400
    throw error
  }
  let periodEnd = null
  const subscriptionId = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id
  if (subscriptionId && stripe.subscriptions?.retrieve) {
    try {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId)
      periodEnd = periodEndFromUnix(subscription.current_period_end, now)
    } catch {
      periodEnd = null
    }
  }
  await activateTigerPassFromCheckout(sb, { ...session, current_period_end: periodEnd ? Math.floor(new Date(periodEnd).getTime() / 1000) : null }, now)
  return loadRiderPass(sb, user.id, now)
}

export async function cancelTigerPass(sb, user, { stripe, now = new Date() } = {}) {
  const existing = await readPassRow(sb, user.id)
  if (!existing) return loadRiderPass(sb, user.id, now)
  if (existing.stripe_subscription_id && stripe?.subscriptions?.update) {
    try {
      await stripe.subscriptions.update(existing.stripe_subscription_id, { cancel_at_period_end: true })
    } catch {
      /* local cancel still records the rider's request */
    }
  }
  const periodPassed = existing.current_period_end && new Date(existing.current_period_end).getTime() <= now.getTime()
  await writePassPatch(sb, user.id, {
    status: existing.stripe_subscription_id && existing.current_period_end && !periodPassed ? 'active' : 'canceled',
    cancel_at_period_end: Boolean(existing.stripe_subscription_id && existing.current_period_end && !periodPassed),
    current_period_end: existing.current_period_end,
  })
  return loadRiderPass(sb, user.id, now)
}

/** Subscription metadata may sit on the object or on the invoice's subscription details. */
export function tigerPassMeta(object) {
  if (!object || typeof object !== 'object') return null
  const candidates = [
    object.metadata,
    object.subscription_details?.metadata,
    object.parent?.subscription_details?.metadata,
  ]
  for (const meta of candidates) {
    if (meta?.kind === TIGER_PASS_PRODUCT_ID) return meta
  }
  return null
}

function stripeSubscriptionId(object) {
  if (!object || typeof object !== 'object') return null
  if (object.object === 'subscription' && typeof object.id === 'string') return object.id
  if (typeof object.subscription === 'string') return object.subscription
  const parentSub = object.parent?.subscription_details?.subscription
  if (typeof parentSub === 'string') return parentSub
  const legacy = object.subscription_details?.subscription
  if (typeof legacy === 'string') return legacy
  return null
}

export async function syncTigerPassFromStripe(sb, object, now = new Date()) {
  const meta = tigerPassMeta(object)
  if (!meta) return { skipped: true, reason: 'not_tiger_pass' }
  if (!sb) return { skipped: true, reason: 'no_service_role' }
  const subscriptionId = stripeSubscriptionId(object)
  let riderId = meta.profile_id || null
  if (!riderId && subscriptionId) {
    const found = await sb.from('rider_subscriptions').select('rider_id').eq('stripe_subscription_id', subscriptionId).maybeSingle()
    riderId = found?.data?.rider_id || null
  }
  if (!riderId) return { skipped: true, reason: 'missing_metadata' }
  if (object.object === 'invoice') {
    if (!object.paid && object.status !== 'paid') return { skipped: true, reason: 'unpaid' }
    const end = object.lines?.data?.[0]?.period?.end || object.period_end
    const existing = await readPassRow(sb, riderId)
    await activateTigerPass(sb, {
      riderId,
      stripeCustomerId: typeof object.customer === 'string' ? object.customer : null,
      stripeSubscriptionId: subscriptionId,
      periodEnd: periodEndFromUnix(end, now),
      cancelAtPeriodEnd: Boolean(existing?.cancel_at_period_end),
      now,
    })
    return { ok: true, riderId, status: 'active' }
  }
  const stripeStatus = String(object.status || '')
  if (stripeStatus === 'canceled' || stripeStatus === 'incomplete_expired') {
    await writePassPatch(sb, riderId, {
      status: 'canceled',
      cancel_at_period_end: false,
      stripe_subscription_id: subscriptionId,
      current_period_end: object.current_period_end ? periodEndFromUnix(object.current_period_end, now) : null,
    })
    return { ok: true, riderId, status: 'canceled' }
  }
  if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') {
    await writePassPatch(sb, riderId, { status: 'past_due', stripe_subscription_id: subscriptionId })
    return { ok: true, riderId, status: 'past_due' }
  }
  if (stripeStatus === 'active' || stripeStatus === 'trialing') {
    await activateTigerPass(sb, {
      riderId,
      stripeCustomerId: typeof object.customer === 'string' ? object.customer : null,
      stripeSubscriptionId: subscriptionId,
      periodEnd: periodEndFromUnix(object.current_period_end, now),
      cancelAtPeriodEnd: Boolean(object.cancel_at_period_end),
      now,
    })
    return { ok: true, riderId, status: 'active' }
  }
  return { skipped: true, reason: 'ignored_status' }
}
