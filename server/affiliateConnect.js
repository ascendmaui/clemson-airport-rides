/**
 * Stripe Connect Express for affiliates. Test mode only (sk_test_ on the
 * Crimson Rides account). Live keys and any ScreenshotSticky key are refused
 * before an account, Account Link, or Transfer is created.
 */
import {
  connectLinkUrls,
  connectOnboardingStatus,
  isAffiliateTestKey,
  isAllowedAppOrigin,
} from '../shared/affiliates/rules.js'

export const AFFILIATE_CONNECT_EVENT_TYPES = [
  'account.updated',
  'transfer.created',
  'transfer.updated',
  'transfer.reversed',
  'payout.created',
  'payout.updated',
  'payout.paid',
  'payout.failed',
  'payout.canceled',
]

const CONNECT_EVENTS = new Set(AFFILIATE_CONNECT_EVENT_TYPES)

export function isAffiliateConnectEvent(type) {
  return CONNECT_EVENTS.has(type)
}

export function appOriginFromRequest(req) {
  const header = req?.headers?.origin || req?.headers?.referer || ''
  try {
    const origin = new URL(String(header)).origin
    if (isAllowedAppOrigin(origin)) return origin
  } catch { /* fall through */ }
  const env = String(process.env.APP_URL || process.env.VITE_APP_URL || '').trim().replace(/\/$/, '')
  if (env && isAllowedAppOrigin(env)) return env
  return 'https://clemsonrides.com'
}

export function connectPatchFromAccount(account, previous = {}) {
  const status = connectOnboardingStatus(account)
  const patch = {
    stripe_account_id: account.id,
    stripe_connect_status: status,
    stripe_details_submitted: account.details_submitted === true,
    stripe_payouts_enabled: account.payouts_enabled === true,
    stripe_charges_enabled: account.charges_enabled === true,
    stripe_disabled_reason: account.requirements?.disabled_reason || null,
    updated_at: new Date().toISOString(),
  }
  if (status === 'verified' && !previous.stripe_onboarded_at) {
    patch.stripe_onboarded_at = new Date().toISOString()
  }
  return patch
}

export function expressAccountParams(affiliate) {
  const company = affiliate.partner_type === 'campus_org' || affiliate.partner_type === 'local_business'
  return {
    type: 'express',
    country: 'US',
    email: affiliate.contact_email,
    capabilities: { transfers: { requested: true } },
    business_type: company ? 'company' : 'individual',
    ...(company ? { company: { name: affiliate.org_name || affiliate.display_name } } : {}),
    business_profile: {
      name: affiliate.org_name || affiliate.display_name,
      ...(affiliate.website ? { url: affiliate.website } : {}),
    },
    metadata: {
      affiliate_id: String(affiliate.id),
      program: 'affiliate',
      platform: 'crimson_rides',
    },
  }
}

export async function createExpressAccount(stripe, affiliate) {
  return stripe.accounts.create(expressAccountParams(affiliate))
}

export async function createOnboardingLink(stripe, accountId, origin) {
  const urls = connectLinkUrls(origin)
  return stripe.accountLinks.create({
    account: accountId,
    refresh_url: urls.refresh_url,
    return_url: urls.return_url,
    type: 'account_onboarding',
  })
}

export async function refreshAffiliateConnect(sb, affiliate, stripe) {
  if (!affiliate?.stripe_account_id || !stripe) return affiliate
  const account = await stripe.accounts.retrieve(affiliate.stripe_account_id)
  const patch = connectPatchFromAccount(account, affiliate)
  const up = await sb.from('affiliates').update(patch).eq('id', affiliate.id)
  if (up?.error) throw new Error(up.error.message)
  return { ...affiliate, ...patch }
}

/**
 * Transfer each approved stripe_connect commission to its connected account.
 * Ride-credit rows are skipped. A non-test key does not call Stripe.
 */
export async function transferApprovedCommissions(sb, entries, affiliatesById, stripe, key) {
  if (!isAffiliateTestKey(key)) {
    return { skipped: true, reason: 'test_mode_only', results: [] }
  }
  if (!stripe) return { skipped: true, reason: 'stripe_unavailable', results: [] }
  const results = []
  for (const entry of entries || []) {
    const affiliate = affiliatesById.get(entry.affiliate_id)
    if ((affiliate?.payout_method || 'ride_credit') !== 'stripe_connect') continue
    try {
      if (!affiliate.stripe_account_id || affiliate.stripe_connect_status !== 'verified') {
        throw new Error('Connected account is not verified')
      }
      const transfer = await stripe.transfers.create({
        amount: entry.amount_cents,
        currency: 'usd',
        destination: affiliate.stripe_account_id,
        metadata: {
          kind: 'affiliate_payout',
          ledger_id: entry.id,
          batch_id: entry.batch_id || '',
          affiliate_id: affiliate.id,
        },
      }, { idempotencyKey: `affiliate:${entry.id}` })
      const paid = await sb.from('affiliate_ledger').update({
        status: 'paid',
        paid_at: new Date().toISOString(),
        payout_method: 'stripe_connect',
        payout_ref: transfer.id,
      }).eq('id', entry.id).eq('status', 'approved')
      if (paid?.error) throw new Error(paid.error.message)
      results.push({ id: entry.id, ok: true, method: 'stripe_connect', ref: transfer.id })
    } catch (err) {
      results.push({ id: entry.id, ok: false, method: 'stripe_connect', error: err.message })
    }
  }
  return { skipped: false, results }
}

function affiliateIdFromAccount(account) {
  const id = account?.metadata?.affiliate_id
  return typeof id === 'string' && id ? id : null
}

async function findAffiliateForAccount(sb, account) {
  const accountId = account?.id
  if (accountId) {
    const byAccount = await sb.from('affiliates').select('*').eq('stripe_account_id', accountId).maybeSingle()
    if (byAccount?.error) return { error: byAccount.error.message }
    if (byAccount?.data) return { affiliate: byAccount.data }
  }
  const affiliateId = affiliateIdFromAccount(account)
  if (!affiliateId) return { affiliate: null }
  const byId = await sb.from('affiliates').select('*').eq('id', affiliateId).maybeSingle()
  if (byId?.error) return { error: byId.error.message }
  if (byId?.data && account?.metadata?.program === 'affiliate') return { affiliate: byId.data }
  return { affiliate: null }
}

async function syncAccountEvent(sb, event) {
  const account = event.data?.object
  const found = await findAffiliateForAccount(sb, account)
  if (found.error) return { ok: false, retryable: true, error: found.error }
  if (!found.affiliate) return { ok: true, skipped: true, reason: 'not_affiliate' }
  const patch = connectPatchFromAccount(account, found.affiliate)
  const up = await sb.from('affiliates').update(patch).eq('id', found.affiliate.id)
  if (up?.error) return { ok: false, retryable: true, error: up.error.message }
  return { ok: true, affiliate_id: found.affiliate.id, connect_status: patch.stripe_connect_status }
}

async function insertPayoutEvent(sb, row) {
  const ins = await sb.from('affiliate_payout_events').insert(row)
  if (ins?.error) {
    if (/duplicate|unique/i.test(ins.error.message || '')) return { ok: true, duplicate: true }
    return { ok: false, retryable: true, error: ins.error.message }
  }
  return { ok: true }
}

async function recordTransferEvent(sb, event) {
  const transfer = event.data?.object || {}
  const ledgerId = transfer.metadata?.ledger_id || null
  let affiliate = null
  if (transfer.metadata?.kind === 'affiliate_payout' && ledgerId) {
    const ledger = await sb.from('affiliate_ledger').select('id, affiliate_id').eq('id', ledgerId).maybeSingle()
    if (ledger?.error) return { ok: false, retryable: true, error: ledger.error.message }
    if (ledger?.data) affiliate = { id: ledger.data.affiliate_id }
  }
  if (!affiliate && transfer.destination) {
    const row = await sb.from('affiliates').select('id').eq('stripe_account_id', transfer.destination).maybeSingle()
    if (row?.error) return { ok: false, retryable: true, error: row.error.message }
    affiliate = row?.data || null
  }
  if (!affiliate) return { ok: true, skipped: true, reason: 'not_affiliate' }
  const status = event.type === 'transfer.reversed' || transfer.reversed ? 'reversed' : (transfer.status || 'created')
  return insertPayoutEvent(sb, {
    affiliate_id: affiliate.id,
    ledger_id: ledgerId,
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_object_id: transfer.id || null,
    amount_cents: Number.isFinite(transfer.amount) ? transfer.amount : null,
    currency: transfer.currency || 'usd',
    status,
  })
}

async function recordConnectedPayoutEvent(sb, event) {
  const accountId = event.account || event.data?.object?.destination || null
  if (!accountId) return { ok: true, skipped: true, reason: 'no_account' }
  const row = await sb.from('affiliates').select('id').eq('stripe_account_id', accountId).maybeSingle()
  if (row?.error) return { ok: false, retryable: true, error: row.error.message }
  if (!row?.data) return { ok: true, skipped: true, reason: 'not_affiliate' }
  const payout = event.data?.object || {}
  return insertPayoutEvent(sb, {
    affiliate_id: row.data.id,
    ledger_id: null,
    stripe_event_id: event.id,
    event_type: event.type,
    stripe_object_id: payout.id || null,
    amount_cents: Number.isFinite(payout.amount) ? payout.amount : null,
    currency: payout.currency || 'usd',
    status: payout.status || event.type.split('.')[1] || null,
  })
}

/** Connect webhook side effects. Live-mode events are ignored by the caller. */
export async function handleAffiliateConnectEvent(sb, event) {
  const type = event?.type
  switch (type) {
    case 'account.updated':
      return syncAccountEvent(sb, event)
    case 'transfer.created':
    case 'transfer.updated':
    case 'transfer.reversed':
      return recordTransferEvent(sb, event)
    case 'payout.created':
    case 'payout.updated':
    case 'payout.paid':
    case 'payout.failed':
    case 'payout.canceled':
      return recordConnectedPayoutEvent(sb, event)
    default: {
      const unexpected = /** @type {never} */ (type)
      return { ok: true, skipped: true, reason: 'unhandled', type: unexpected }
    }
  }
}
