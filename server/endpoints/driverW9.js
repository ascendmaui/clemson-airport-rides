/**
 * GET  /api/driver?action=w9
 * POST /api/driver?action=w9
 *
 * Stripe Connect drivers update tax info on a Stripe-hosted Account Link.
 * That path never sends a TIN to this app. This endpoint does not accept a
 * TIN and never returns one. Local W-9 saves go through save_driver_w9_record,
 * which stores ciphertext and returns the last four only.
 */
import { admin, cors, json, parseBody, stripeClient, userFromAuth } from '../friendRideLib.js'
import { loadConnectAccount } from '../payouts.js'
import { W9_PUBLIC_COLUMNS, responseContainsTin, toPublicW9 } from '../../shared/driverW9.js'

const TIN_KEYS = ['tin', 'ssn', 'ein', 'tin_ciphertext', 'tinCiphertext', 'taxpayer_id']

export function appOrigin(req) {
  const header = req?.headers?.origin || req?.headers?.referer || ''
  try {
    const origin = new URL(String(header)).origin
    if (/^https:\/\/([a-z0-9-]+\.)?clemsonrides\.com$/i.test(origin)) return origin
    if (origin === 'http://localhost:5173' || origin === 'http://localhost:8081') return origin
  } catch {
    /* fall through */
  }
  return 'https://clemsonrides.com'
}

export async function createDriverTaxLink(stripe, accountId, origin) {
  const account = await stripe.accounts.retrieve(accountId)
  const submitted = account?.details_submitted === true
  const type = submitted ? 'account_update' : 'account_onboarding'
  const link = await stripe.accountLinks.create({
    account: accountId,
    refresh_url: `${origin}/#/driver-w9`,
    return_url: `${origin}/#/driver-w9`,
    type,
    collection_options: { fields: 'eventually_due' },
  })
  return {
    url: link?.url || null,
    type,
    stripeDetailsSubmitted: submitted,
  }
}

function bodyHasTin(body) {
  if (!body || typeof body !== 'object') return false
  return TIN_KEYS.some((key) => body[key] != null && String(body[key]).trim() !== '')
}

async function readStatus(sb, userId) {
  const primary = await sb.from('driver_w9').select(W9_PUBLIC_COLUMNS).eq('profile_id', userId).maybeSingle()
  if (!primary?.error && primary?.data) return toPublicW9(primary.data)
  const fallback = await sb
    .from('driver_tax_info')
    .select('legal_name, business_name, tax_classification, address_line, tin_last4, updated_at')
    .eq('profile_id', userId)
    .maybeSingle()
  if (fallback?.error || !fallback?.data) return null
  return toPublicW9({ ...fallback.data, collection: 'app', certified: false })
}

export async function loadW9Desk(sb, userId, { stripe = null, origin = 'https://clemsonrides.com' } = {}) {
  const accountId = await loadConnectAccount(sb, userId)
  let updateUrl = null
  let stripeDetailsSubmitted = false
  let stripeError = null
  if (accountId && stripe) {
    try {
      const link = await createDriverTaxLink(stripe, accountId, origin)
      updateUrl = link.url
      stripeDetailsSubmitted = link.stripeDetailsSubmitted
    } catch (err) {
      stripeError = err instanceof Error ? err.message : 'Could not open Stripe'
    }
  }
  const status = await readStatus(sb, userId)
  return {
    stripeConnect: Boolean(accountId),
    updateUrl,
    stripeDetailsSubmitted,
    stripeError,
    status,
  }
}

export default async function handler(req, res, deps = {}) {
  if (cors(req, res)) return
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader?.('Allow', 'GET, POST, OPTIONS')
    res.setHeader?.('Cache-Control', 'no-store')
    return json(res, 405, { error: 'Method not allowed' })
  }
  const parsed = parseBody(req)
  if (parsed.error) return json(res, 400, { error: parsed.error })
  if (bodyHasTin(parsed.body)) {
    const payload = { error: 'The tax id is saved only by the encrypted W-9 record. This endpoint does not accept or return it.' }
    if (responseContainsTin(payload, parsed.body.tin || parsed.body.ssn || parsed.body.ein)) {
      return json(res, 400, { error: 'Could not save tax info' })
    }
    return json(res, 400, payload)
  }
  const sb = deps.sb !== undefined ? deps.sb : (deps.admin ? deps.admin() : admin())
  if (!sb) return json(res, 503, { error: 'SUPABASE_SERVICE_ROLE_KEY not configured' })
  const user = deps.user !== undefined ? deps.user : await (deps.userFromAuth || userFromAuth)(req, sb)
  if (!user) return json(res, 401, { error: 'Sign in required' })
  const stripe = deps.stripe !== undefined ? deps.stripe : stripeClient()
  try {
    const desk = await loadW9Desk(sb, user.id, { stripe, origin: appOrigin(req) })
    res.setHeader?.('Cache-Control', 'no-store')
    return json(res, 200, desk)
  } catch (err) {
    res.setHeader?.('Cache-Control', 'no-store')
    return json(res, 500, { error: err instanceof Error ? err.message : 'Could not load W-9 status' })
  }
}
