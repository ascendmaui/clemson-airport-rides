/**
 * Stripe Connect Express payout desk for drivers. Test mode only.
 * Account links and the Express dashboard login link add or remove banks
 * and cards. This module never stores a full account number.
 */
import { cashoutQuote, executeCashout } from './cashout.js'
import { loadConnectAccount } from './payouts.js'
import {
  expressTestKeyAllowed,
  payoutStatusChip,
  publicPayoutMethod,
  shouldApplyPayoutStatus,
  usdCents,
} from '../shared/driverPayoutMethods.js'

export const DRIVER_CONNECT_EVENT_TYPES = [
  'account.updated',
  'payout.created',
  'payout.updated',
  'payout.paid',
  'payout.failed',
  'payout.canceled',
]

const DRIVER_EVENTS = new Set(DRIVER_CONNECT_EVENT_TYPES)

export function isDriverConnectEvent(type) {
  return DRIVER_EVENTS.has(type)
}

export function expressAccountParams(user) {
  return {
    type: 'express',
    country: 'US',
    email: user?.email || undefined,
    capabilities: { transfers: { requested: true } },
    business_type: 'individual',
    metadata: {
      driver_id: String(user?.id || ''),
      program: 'driver',
      platform: 'clemson_rides',
    },
  }
}

export async function createDriverAccountLink(stripe, accountId, origin, submitted) {
  const type = submitted ? 'account_update' : 'account_onboarding'
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${origin}/#/driver-payouts`,
    return_url: `${origin}/#/driver-payouts`,
    type,
    collection_options: { fields: 'eventually_due' },
  })
  return { url: link?.url || null, type }
}

function missingRelation(error) {
  return /schema cache|does not exist|could not find the table|column/i.test(error?.message || '')
}

async function listExternal(stripe, accountId) {
  if (!stripe?.accounts?.listExternalAccounts || !accountId) return []
  const [banks, cards] = await Promise.all([
    stripe.accounts.listExternalAccounts(accountId, { object: 'bank_account', limit: 10 }),
    stripe.accounts.listExternalAccounts(accountId, { object: 'card', limit: 10 }),
  ])
  return [...(banks?.data || []), ...(cards?.data || [])]
    .map(publicPayoutMethod)
    .filter(Boolean)
}

async function readHistory(sb, driverId) {
  const res = await sb.from('driver_payout_events')
    .select('id, amount_cents, status, method, created_at, stripe_payout_id')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false })
    .limit(30)
  if (res?.error) {
    if (missingRelation(res.error)) return []
    throw new Error(res.error.message)
  }
  return (res.data || []).map((row) => ({
    id: row.id,
    amountCents: Math.max(0, Math.round(Number(row.amount_cents) || 0)),
    status: payoutStatusChip(row.status),
    method: row.method === 'instant' || row.method === 'standard' ? row.method : null,
    createdAt: row.created_at || null,
    payoutId: row.stripe_payout_id || null,
  }))
}

export async function loadPayoutDesk({ sb, stripe, driverId, env = process.env, origin = 'https://clemsonrides.com', now = new Date() }) {
  if (!expressTestKeyAllowed(env.STRIPE_SECRET_KEY)) {
    return { ok: false, status: 403, error: 'live_keys_blocked' }
  }
  const accountId = await loadConnectAccount(sb, driverId)
  let detailsSubmitted = false
  let payoutsEnabled = false
  let setupUrl = null
  let dashboardUrl = null
  let methods = []
  let availableCents = 0
  let pendingCents = 0
  if (accountId && stripe) {
    const account = await stripe.accounts.retrieve(accountId)
    detailsSubmitted = account?.details_submitted === true
    payoutsEnabled = account?.payouts_enabled === true
    const link = await createDriverAccountLink(stripe, accountId, origin, detailsSubmitted)
    setupUrl = link.url
    if (detailsSubmitted && stripe.accounts.createLoginLink) {
      const login = await stripe.accounts.createLoginLink(accountId)
      dashboardUrl = login?.url || null
    }
    methods = await listExternal(stripe, accountId)
    if (stripe.balance?.retrieve) {
      const balance = await stripe.balance.retrieve({}, { stripeAccount: accountId })
      availableCents = usdCents(balance?.available)
      pendingCents = usdCents(balance?.pending)
    }
  }
  const [instant, standard] = await Promise.all([
    cashoutQuote({ sb, stripe, driverId, env, now, method: 'instant' }),
    cashoutQuote({ sb, stripe, driverId, env, now, method: 'standard' }),
  ])
  delete instant.connectAccountId
  delete standard.connectAccountId
  return {
    ok: true,
    stripeConnect: Boolean(accountId),
    detailsSubmitted,
    payoutsEnabled,
    availableCents,
    pendingCents,
    methods,
    setupUrl,
    dashboardUrl,
    instant,
    standard,
    history: await readHistory(sb, driverId),
  }
}

export async function startDirectDeposit({ sb, stripe, user, env = process.env, origin = 'https://clemsonrides.com' }) {
  if (!expressTestKeyAllowed(env.STRIPE_SECRET_KEY)) {
    return { ok: false, status: 403, error: 'live_keys_blocked' }
  }
  if (!stripe?.accounts?.create || !stripe?.accountLinks?.create) {
    return { ok: false, status: 503, error: 'Stripe not configured' }
  }
  let accountId = await loadConnectAccount(sb, user.id)
  let created = false
  if (!accountId) {
    const account = await stripe.accounts.create(expressAccountParams(user))
    accountId = account?.id || null
    created = true
    if (!accountId) return { ok: false, status: 502, error: 'stripe_account_missing' }
    const saved = await sb.from('profiles').update({ stripe_account_id: accountId }).eq('id', user.id)
    if (saved?.error) return { ok: false, status: 500, error: saved.error.message }
  }
  const current = created ? null : await stripe.accounts.retrieve(accountId)
  const submitted = current?.details_submitted === true
  const link = await createDriverAccountLink(stripe, accountId, origin, submitted)
  return { ok: true, url: link.url, type: link.type, created }
}

export async function cashOutDriver({ sb, stripe, driverId, method, expectedFeeCents, env = process.env, now = new Date() }) {
  if (!expressTestKeyAllowed(env.STRIPE_SECRET_KEY)) {
    return { ok: false, status: 403, error: 'live_keys_blocked' }
  }
  if (method !== 'instant' && method !== 'standard') {
    return { ok: false, status: 400, error: 'choose_instant_or_standard' }
  }
  return executeCashout({ sb, stripe, driverId, expectedFeeCents, method, env, now })
}

async function findDriver(sb, accountId, account) {
  const metaId = account?.metadata?.program === 'driver' ? account.metadata.driver_id : null
  if (metaId) return { id: metaId }
  if (!accountId) return null
  const byAccount = await sb.from('profiles').select('id').eq('stripe_account_id', accountId).maybeSingle()
  if (byAccount?.error) {
    if (missingRelation(byAccount.error)) return null
    throw new Error(byAccount.error.message)
  }
  if (byAccount?.data?.id) return byAccount.data
  const byConnect = await sb.from('profiles').select('id').eq('stripe_connect_id', accountId).maybeSingle()
  if (byConnect?.error) {
    if (missingRelation(byConnect.error)) return null
    throw new Error(byConnect.error.message)
  }
  return byConnect?.data?.id ? byConnect.data : null
}

async function syncDriverAccount(sb, event) {
  const account = event.data?.object || {}
  const driver = await findDriver(sb, account.id, account)
  if (!driver) return { ok: true, skipped: true, reason: 'not_driver' }
  const patch = {
    stripe_account_id: account.id,
    stripe_details_submitted: account.details_submitted === true,
    stripe_payouts_enabled: account.payouts_enabled === true,
  }
  const up = await sb.from('profiles').update(patch).eq('id', driver.id)
  if (up?.error) {
    if (missingRelation(up.error)) return { ok: true, skipped: true, reason: 'not_ready' }
    return { ok: false, retryable: true, error: up.error.message }
  }
  return { ok: true, driver_id: driver.id, payouts_enabled: patch.stripe_payouts_enabled }
}

async function syncDriverPayout(sb, event) {
  const payout = event.data?.object || {}
  const accountId = event.account || null
  const driver = await findDriver(sb, accountId, null)
  if (!driver) return { ok: true, skipped: true, reason: 'not_driver' }
  if (!payout.id) return { ok: true, skipped: true, reason: 'no_payout' }
  const next = payoutStatusChip(payout.status || String(event.type || '').split('.')[1])
  const existing = await sb.from('driver_payout_events').select('id, status').eq('stripe_payout_id', payout.id).maybeSingle()
  if (existing?.error) {
    if (missingRelation(existing.error)) return { ok: true, skipped: true, reason: 'not_ready' }
    return { ok: false, retryable: true, error: existing.error.message }
  }
  if (existing?.data && !shouldApplyPayoutStatus(existing.data.status, next)) {
    return { ok: true, skipped: true, reason: 'status_not_rewound', status: existing.data.status }
  }
  const row = {
    driver_id: driver.id,
    stripe_account_id: accountId,
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_payout_id: payout.id,
    amount_cents: Number.isFinite(payout.amount) ? payout.amount : null,
    currency: payout.currency || 'usd',
    status: next,
    method: payout.method === 'instant' || payout.method === 'standard' ? payout.method : null,
    updated_at: new Date().toISOString(),
  }
  const saved = existing?.data
    ? await sb.from('driver_payout_events').update(row).eq('id', existing.data.id)
    : await sb.from('driver_payout_events').insert(row)
  if (saved?.error) {
    if (/duplicate|unique/i.test(saved.error.message || '')) return { ok: true, duplicate: true }
    if (missingRelation(saved.error)) return { ok: true, skipped: true, reason: 'not_ready' }
    return { ok: false, retryable: true, error: saved.error.message }
  }
  return { ok: true, driver_id: driver.id, status: next, payout_id: payout.id }
}

export async function handleDriverConnectEvent(sb, event) {
  if (event?.livemode === true) return { ok: true, skipped: true, reason: 'live_mode' }
  const type = event?.type
  if (!isDriverConnectEvent(type)) return { ok: true, skipped: true, reason: 'unhandled' }
  try {
    switch (type) {
      case 'account.updated':
        return await syncDriverAccount(sb, event)
      case 'payout.created':
      case 'payout.updated':
      case 'payout.paid':
      case 'payout.failed':
      case 'payout.canceled':
        return await syncDriverPayout(sb, event)
      default: {
        const unexpected = /** @type {never} */ (type)
        return { ok: true, skipped: true, reason: 'unhandled', type: unexpected }
      }
    }
  } catch (err) {
    if (missingRelation(err)) return { ok: true, skipped: true, reason: 'not_ready' }
    return { ok: false, retryable: true, error: err instanceof Error ? err.message : 'driver_payout_webhook_failed' }
  }
}
