/**
 * Affiliate program API.
 *
 * Public:  POST ?action=click   {code, device_id}            — /r/CODE landing
 *          GET  ?action=lookup&code=CODE                     — show partner name on landing
 *          GET  ?action=plan                                 — Option C commission plan
 * Signed in:
 *          POST ?action=apply   {partner_type, display_name, …} — /affiliates sign-up
 *          POST ?action=claim   {code, role, device_id}       — attribution at rider/driver signup
 *          GET  ?action=me                                     — dashboard stats + ledger
 *          POST ?action=connect-start                          — Express account + Account Link
 *          POST ?action=connect-sync                           — refresh onboarding status after return
 * Admin:   GET  ?action=admin-overview
 *          POST ?action=admin-status   {affiliate_id, status}
 *          POST ?action=admin-rates    {rates}
 *          POST ?action=admin-batch-create
 *          POST ?action=admin-batch-approve {batch_id}
 *          POST ?action=admin-batch-pay     {batch_id}
 *          POST ?action=admin-entry-void    {entry_id, note}
 *
 * Money: ride credit (internal) or Stripe Connect transfers ONLY with an
 * sk_test_ key. A live key refuses to transfer.
 */
import { createHash } from 'node:crypto'
import { cors, json, parseBody, userFromAuth, admin, stripeClient } from '../friendRideLib.js'
import { resolveRouteAction } from '../routeAction.js'
import { loadStaffAccess } from '../staffAccess.js'
import { supabaseCreditStore } from '../credits.js'
import {
  AFFILIATE_MATERIALS_URL,
  AFFILIATE_PARTNER_TYPES,
  AFFILIATE_RATES_DEFAULTS,
} from '../../shared/affiliates/config.js'
import {
  affiliateLink,
  attributionDecision,
  describeAffiliatePlan,
  generateAffiliateCode,
  isAffiliateTestKey,
  maskReferralName,
  normalizeAffiliateCode,
  normalizePhone,
  payoutHistory,
  planPayoutBatch,
  summarizeLedger,
  validateAffiliateApplication,
} from '../../shared/affiliates/rules.js'
import {
  appOriginFromRequest,
  createExpressAccount,
  createOnboardingLink,
  refreshAffiliateConnect,
  transferApprovedCommissions,
} from '../affiliateConnect.js'

export const AFFILIATE_ACTIONS = [
  'click', 'lookup', 'plan', 'apply', 'claim', 'me', 'connect-start', 'connect-sync',
  'admin-overview', 'admin-status', 'admin-rates', 'admin-batch-create', 'admin-batch-approve', 'admin-batch-pay', 'admin-entry-void',
]
const GET_ACTIONS = new Set(['lookup', 'plan', 'me', 'admin-overview'])
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function hashId(value) {
  const v = String(value || '').trim()
  if (!v || v.length > 200) return null
  const salt = process.env.AFFILIATE_HASH_SALT || 'clemson-rides-affiliate'
  return createHash('sha256').update(`${salt}:${v}`).digest('hex').slice(0, 40)
}

function clientIp(req) {
  const fwd = req.headers?.['x-forwarded-for'] || ''
  return String(Array.isArray(fwd) ? fwd[0] : fwd).split(',')[0].trim() || req.socket?.remoteAddress || ''
}

async function loadRates(sb) {
  const row = await sb.from('affiliate_config').select('value').eq('key', 'rates').maybeSingle()
  return { ...AFFILIATE_RATES_DEFAULTS, ...(row.data?.value || {}), partner_type_bps: { ...AFFILIATE_RATES_DEFAULTS.partner_type_bps, ...(row.data?.value?.partner_type_bps || {}) } }
}

export function createAffiliatesHandler(deps = {}) {
  const getSb = deps.admin || admin
  const getUser = deps.userFromAuth || userFromAuth
  const getStaff = deps.loadStaffAccess || loadStaffAccess
  const getStripe = deps.stripeClient || stripeClient
  const stripeKey = () => (deps.stripeKey ?? process.env.STRIPE_SECRET_KEY ?? '')

  return async function handler(req, res) {
    if (cors(req, res)) return
    const action = resolveRouteAction(req, { allowed: AFFILIATE_ACTIONS })
    if (!action) return json(res, 400, { error: 'Unknown affiliate action' })
    const wantsGet = GET_ACTIONS.has(action)
    if (wantsGet && req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' })
    if (!wantsGet && req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })
    const sb = getSb()
    if (!sb) return json(res, 503, { error: 'Affiliate service unavailable' })
    const url = new URL(req.url || '/', 'http://localhost')
    const { body, error } = wantsGet ? { body: {} } : parseBody(req)
    if (error) return json(res, 400, { error })

    try {
      if (action === 'click') return await click(sb, req, res, body)
      if (action === 'lookup') return await lookup(sb, res, url.searchParams.get('code'))
      if (action === 'plan') return await publicPlan(sb, res)
      const user = await getUser(req)
      if (!user) return json(res, 401, { error: 'Sign in required' })
      if (action === 'apply') return await apply(sb, res, user, body)
      if (action === 'claim') return await claim(sb, res, user, body)
      if (action === 'me') return await me(sb, res, user)
      if (action === 'connect-start') return await connectStart(sb, res, user, req, getStripe, stripeKey())
      if (action === 'connect-sync') return await connectSync(sb, res, user, getStripe, stripeKey())
      const access = await getStaff(sb, user)
      if (!access?.admin) return json(res, 403, { error: 'Admin only' })
      switch (action) {
        case 'admin-overview': return await adminOverview(sb, res)
        case 'admin-status': return await adminStatus(sb, res, body)
        case 'admin-rates': return await adminRates(sb, res, user, body)
        case 'admin-batch-create': return await batchCreate(sb, res, user, getStripe)
        case 'admin-batch-approve': return await batchApprove(sb, res, user, body, getStripe, stripeKey())
        case 'admin-batch-pay': return await batchPay(sb, res, body, getStripe, stripeKey())
        case 'admin-entry-void': return await entryVoid(sb, res, body)
        default: {
          const unexpected = /** @type {never} */ (action)
          return json(res, 400, { error: 'Unknown affiliate action', action: unexpected })
        }
      }
    } catch (err) {
      console.error('[affiliates]', action, err?.message)
      return json(res, 500, { error: 'Affiliate request failed' })
    }
  }
}

async function activeAffiliateByCode(sb, raw) {
  const code = normalizeAffiliateCode(raw)
  if (!code) return null
  const found = await sb.from('affiliates').select('*').eq('code', code).maybeSingle()
  return found.data || null
}

async function click(sb, req, res, body) {
  const aff = await activeAffiliateByCode(sb, body.code)
  if (!aff || aff.status !== 'active') return json(res, 404, { error: 'That partner link is not active', code: 'inactive_code' })
  const device_hash = hashId(body.device_id)
  // One counted click per device per affiliate per 24h.
  if (device_hash) {
    const since = new Date(Date.now() - 86400000).toISOString()
    const seen = await sb.from('affiliate_clicks').select('id').eq('affiliate_id', aff.id).eq('device_hash', device_hash).gte('created_at', since).limit(1)
    if (seen.data?.length) return json(res, 200, { ok: true, code: aff.code, counted: false })
  }
  await sb.from('affiliate_clicks').insert({
    affiliate_id: aff.id,
    device_hash,
    ip_hash: hashId(clientIp(req)),
    user_agent: String(req.headers?.['user-agent'] || '').slice(0, 200),
    landing: String(body.landing || '').slice(0, 200) || null,
  })
  return json(res, 200, { ok: true, code: aff.code, counted: true })
}

async function lookup(sb, res, raw) {
  const aff = await activeAffiliateByCode(sb, raw)
  if (!aff || aff.status !== 'active') return json(res, 404, { error: 'That partner link is not active' })
  return json(res, 200, { code: aff.code, display_name: aff.org_name || aff.display_name, partner_type: aff.partner_type })
}

async function uniqueCode(sb, name) {
  for (let i = 0; i < 8; i++) {
    const code = generateAffiliateCode(name)
    const hit = await sb.from('affiliates').select('id').eq('code', code).maybeSingle()
    if (!hit.data) return code
  }
  throw new Error('Could not allocate affiliate code')
}

async function apply(sb, res, user, body) {
  const check = validateAffiliateApplication(body)
  if (!check.ok) return json(res, 400, { error: 'Check the highlighted fields', errors: check.errors })
  const existing = await sb.from('affiliates').select('*').eq('user_id', user.id).maybeSingle()
  if (existing.data) return json(res, 200, { ok: true, affiliate: publicAffiliate(existing.data), existing: true })
  const code = await uniqueCode(sb, check.value.org_name || check.value.display_name)
  const ins = await sb.from('affiliates').insert({ ...check.value, user_id: user.id, code, status: 'pending' }).select('*').single()
  if (ins.error) return json(res, 400, { error: ins.error.message })
  return json(res, 200, { ok: true, affiliate: publicAffiliate(ins.data) })
}

function publicAffiliate(a) {
  return {
    id: a.id, code: a.code, link: affiliateLink(a.code), status: a.status, partner_type: a.partner_type,
    display_name: a.display_name, org_name: a.org_name, payout_method: a.payout_method, created_at: a.created_at,
    connect_status: a.stripe_connect_status || (a.stripe_account_id ? 'pending' : 'not_started'),
    connect_payouts_enabled: a.stripe_payouts_enabled === true,
  }
}

async function claim(sb, res, user, body) {
  const role = body.role === 'driver' ? 'driver' : 'rider'
  const aff = await activeAffiliateByCode(sb, body.code)
  const [profile, affiliateProfile, existing, prior] = await Promise.all([
    sb.from('profiles').select('id, email, phone, full_name, created_at').eq('id', user.id).maybeSingle(),
    aff?.user_id ? sb.from('profiles').select('phone').eq('id', aff.user_id).maybeSingle() : Promise.resolve({ data: null }),
    sb.from('affiliate_attributions').select('id, affiliate_id').eq('referred_user_id', user.id).eq('role', role).maybeSingle(),
    sb.from('trips').select('id', { count: 'exact', head: true }).eq(role === 'driver' ? 'driver_id' : 'rider_id', user.id).eq('status', 'completed'),
  ])
  const decision = attributionDecision({
    affiliate: aff, user, profile: profile.data, affiliateProfile: affiliateProfile.data,
    existing: existing.data, priorCompleted: prior.count || 0,
  })
  if (!decision.ok) {
    const status = decision.code === 'inactive_code' ? 404 : decision.duplicate ? 200 : 409
    return json(res, status, { ok: false, code: decision.code, attributed: Boolean(existing.data) })
  }
  const ins = await sb.from('affiliate_attributions').insert({
    affiliate_id: aff.id, referred_user_id: user.id, role,
    device_hash: hashId(body.device_id),
    phone_norm: normalizePhone(profile.data?.phone) || null,
    masked_name: maskReferralName(profile.data?.full_name, profile.data?.email || user.email),
  })
  if (ins.error) {
    if (/duplicate|unique/i.test(ins.error.message)) return json(res, 200, { ok: false, code: 'already_attributed' })
    return json(res, 400, { error: ins.error.message })
  }
  return json(res, 200, { ok: true, code: aff.code, role })
}

async function statsFor(sb, affiliateIds) {
  const [clicks, atts, ledger] = await Promise.all([
    sb.from('affiliate_clicks').select('affiliate_id').in('affiliate_id', affiliateIds),
    sb.from('affiliate_attributions').select('affiliate_id, role, status, reject_reason, created_at').in('affiliate_id', affiliateIds),
    sb.from('affiliate_ledger').select('*').in('affiliate_id', affiliateIds).order('created_at', { ascending: false }),
  ])
  const out = new Map(affiliateIds.map((id) => [id, {
    clicks: 0, signups: 0, rider_signups: 0, driver_signups: 0,
    qualified: 0, rider_qualified: 0, driver_qualified: 0, rejected: 0,
    ledger: [], earnings: summarizeLedger([]),
  }]))
  for (const c of clicks.data || []) out.get(c.affiliate_id).clicks += 1
  for (const a of atts.data || []) {
    const s = out.get(a.affiliate_id)
    s.signups += 1
    s[`${a.role}_signups`] += 1
    if (a.status === 'qualified') {
      s.qualified += 1
      s[`${a.role}_qualified`] += 1
    }
    if (a.status === 'rejected') s.rejected += 1
  }
  for (const l of ledger.data || []) out.get(l.affiliate_id).ledger.push(l)
  for (const s of out.values()) s.earnings = summarizeLedger(s.ledger)
  return out
}

async function referralList(sb, affiliateId) {
  const atts = await sb.from('affiliate_attributions')
    .select('id, role, status, created_at, qualified_at, masked_name, referred_user_id')
    .eq('affiliate_id', affiliateId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (atts.error) throw new Error(atts.error.message)
  const rows = atts.data || []
  const missing = rows.filter((a) => !a.masked_name && a.referred_user_id).map((a) => a.referred_user_id)
  const names = new Map()
  if (missing.length) {
    const profs = await sb.from('profiles').select('id, full_name, email').in('id', missing)
    for (const profile of profs.data || []) names.set(profile.id, maskReferralName(profile.full_name, profile.email))
  }
  return rows.map((a) => ({
    id: a.id,
    masked_name: a.masked_name || names.get(a.referred_user_id) || 'Referral',
    role: a.role,
    status: a.status,
    created_at: a.created_at,
    qualified_at: a.qualified_at || null,
  }))
}

async function me(sb, res, user) {
  const row = await sb.from('affiliates').select('*').eq('user_id', user.id).maybeSingle()
  if (!row.data) return json(res, 200, { affiliate: null })
  const [stats, rates, referrals, events] = await Promise.all([
    statsFor(sb, [row.data.id]).then((map) => map.get(row.data.id)),
    loadRates(sb),
    referralList(sb, row.data.id),
    sb.from('affiliate_payout_events')
      .select('id, event_type, amount_cents, currency, status, created_at, stripe_object_id')
      .eq('affiliate_id', row.data.id)
      .order('created_at', { ascending: false })
      .limit(50),
  ])
  const ledger = stats.ledger.slice(0, 50).map((l) => ({
    id: l.id, kind: l.kind, amount_cents: l.amount_cents, status: l.status,
    created_at: l.created_at, paid_at: l.paid_at, payout_method: l.payout_method, payout_ref: l.payout_ref,
  }))
  return json(res, 200, {
    affiliate: publicAffiliate(row.data),
    stats: {
      clicks: stats.clicks, signups: stats.signups,
      rider_signups: stats.rider_signups, driver_signups: stats.driver_signups,
      qualified: stats.qualified, rider_qualified: stats.rider_qualified, driver_qualified: stats.driver_qualified,
    },
    referrals,
    earnings: stats.earnings,
    ledger,
    payouts: payoutHistory(events.data || [], stats.ledger).slice(0, 50),
    materials_url: process.env.AFFILIATE_MATERIALS_URL || AFFILIATE_MATERIALS_URL,
    plan: describeAffiliatePlan(rates),
  })
}

async function publicPlan(sb, res) {
  return json(res, 200, { plan: describeAffiliatePlan(await loadRates(sb)) })
}

async function connectStart(sb, res, user, req, getStripe, key) {
  if (!isAffiliateTestKey(key)) return json(res, 403, { error: 'Stripe test mode is required to connect a payout account' })
  const stripe = getStripe()
  if (!stripe) return json(res, 503, { error: 'Stripe is not configured' })
  const row = await sb.from('affiliates').select('*').eq('user_id', user.id).maybeSingle()
  if (!row.data) return json(res, 404, { error: 'Apply to the partner program first' })
  if (!['pending', 'active', 'paused'].includes(row.data.status)) return json(res, 409, { error: 'This partner account cannot connect payouts' })
  let accountId = row.data.stripe_account_id
  if (!accountId) {
    const account = await createExpressAccount(stripe, row.data)
    accountId = account.id
    const saved = await sb.from('affiliates').update({
      stripe_account_id: accountId,
      stripe_connect_status: 'pending',
      payout_method: 'stripe_connect',
      updated_at: new Date().toISOString(),
    }).eq('id', row.data.id)
    if (saved.error) return json(res, 400, { error: saved.error.message })
  }
  const link = await createOnboardingLink(stripe, accountId, appOriginFromRequest(req))
  const connect_status = row.data.stripe_account_id ? (row.data.stripe_connect_status || 'pending') : 'pending'
  return json(res, 200, { ok: true, url: link.url, connect_status })
}

async function connectSync(sb, res, user, getStripe, key) {
  const row = await sb.from('affiliates').select('*').eq('user_id', user.id).maybeSingle()
  if (!row.data) return json(res, 404, { error: 'Apply to the partner program first' })
  if (!row.data.stripe_account_id) return json(res, 200, { ok: true, affiliate: publicAffiliate(row.data) })
  if (!isAffiliateTestKey(key)) return json(res, 403, { error: 'Stripe test mode is required to refresh payout status' })
  const stripe = getStripe()
  if (!stripe) return json(res, 503, { error: 'Stripe is not configured' })
  const fresh = await refreshAffiliateConnect(sb, row.data, stripe)
  return json(res, 200, { ok: true, affiliate: publicAffiliate(fresh) })
}

async function adminOverview(sb, res) {
  const [affs, batches, rates] = await Promise.all([
    sb.from('affiliates').select('*').order('created_at', { ascending: false }).limit(500),
    sb.from('affiliate_payout_batches').select('*').order('created_at', { ascending: false }).limit(50),
    loadRates(sb),
  ])
  const list = affs.data || []
  const stats = list.length ? await statsFor(sb, list.map((a) => a.id)) : new Map()
  const affiliates = list.map((a) => {
    const s = stats.get(a.id)
    return { ...publicAffiliate(a), contact_email: a.contact_email, phone: a.phone, website: a.website, audience: a.audience,
      stripe_account_id: a.stripe_account_id, clicks: s.clicks, signups: s.signups, qualified: s.qualified,
      rider_qualified: s.rider_qualified, driver_qualified: s.driver_qualified, rejected: s.rejected, earnings: s.earnings }
  })
  const pending = []
  for (const s of stats.values()) pending.push(...s.ledger.filter((l) => l.status === 'pending'))
  return json(res, 200, { affiliates, batches: batches.data || [], rates, pending_entries: pending.length, partner_types: AFFILIATE_PARTNER_TYPES })
}

async function adminStatus(sb, res, body) {
  if (!UUID.test(body.affiliate_id || '')) return json(res, 400, { error: 'affiliate_id required' })
  if (!['pending', 'active', 'paused', 'rejected'].includes(body.status)) return json(res, 400, { error: 'Invalid status' })
  const patch = { status: body.status, updated_at: new Date().toISOString() }
  if (body.status === 'active') patch.approved_at = new Date().toISOString()
  if (['ride_credit', 'stripe_connect'].includes(body.payout_method)) patch.payout_method = body.payout_method
  if (typeof body.stripe_account_id === 'string') patch.stripe_account_id = body.stripe_account_id.trim() || null
  const up = await sb.from('affiliates').update(patch).eq('id', body.affiliate_id).select('*').single()
  if (up.error) return json(res, 400, { error: up.error.message })
  return json(res, 200, { ok: true, affiliate: publicAffiliate(up.data) })
}

const RATE_KEYS = ['rider_first_ride_cents', 'rider_min_fare_cents', 'driver_first_trip_cents', 'hold_days', 'monthly_cap', 'min_payout_cents']
async function adminRates(sb, res, user, body) {
  const current = await loadRates(sb)
  const next = { ...current }
  for (const k of RATE_KEYS) {
    if (body.rates?.[k] == null) continue
    const n = Math.round(Number(body.rates[k]))
    if (!Number.isFinite(n) || n < 0 || n > 100000) return json(res, 400, { error: `Invalid ${k}` })
    next[k] = n
  }
  if (body.rates?.partner_type_bps) {
    next.partner_type_bps = { ...current.partner_type_bps }
    for (const t of AFFILIATE_PARTNER_TYPES) {
      const n = Math.round(Number(body.rates.partner_type_bps[t]))
      if (Number.isFinite(n) && n >= 0 && n <= 30000) next.partner_type_bps[t] = n
    }
  }
  if (typeof body.rates?.placeholder === 'boolean') next.placeholder = body.rates.placeholder
  if (typeof body.rates?.multipliers_pending_confirmation === 'boolean') {
    next.multipliers_pending_confirmation = body.rates.multipliers_pending_confirmation
  }
  const up = await sb.from('affiliate_config').upsert({ key: 'rates', value: next, updated_at: new Date().toISOString(), updated_by: user.id })
  if (up.error) return json(res, 400, { error: up.error.message })
  return json(res, 200, { ok: true, rates: next })
}

/** Stripe card fingerprint of a user's default card, for payment dedupe at batch time. */
async function paymentFingerprint(sb, stripe, userId) {
  const p = await sb.from('profiles').select('stripe_default_pm_id, stripe_card_brand, stripe_card_last4').eq('id', userId).maybeSingle()
  const prof = p.data || {}
  if (stripe && prof.stripe_default_pm_id) {
    try {
      const pm = await stripe.paymentMethods.retrieve(prof.stripe_default_pm_id)
      if (pm?.card?.fingerprint) return `fp:${pm.card.fingerprint}`
    } catch { /* fall through */ }
  }
  return prof.stripe_card_last4 ? `bl:${prof.stripe_card_brand || ''}:${prof.stripe_card_last4}` : null
}

async function batchCreate(sb, res, user, getStripe) {
  const rates = await loadRates(sb)
  const pending = await sb.from('affiliate_ledger').select('*').eq('status', 'pending').is('batch_id', null)
  if (pending.error) return json(res, 400, { error: pending.error.message })
  // Payment-method dedupe: void later entries whose referred user shares a card
  // with an earlier qualified referral (Stripe fingerprint when available).
  const stripe = getStripe()
  const attIds = (pending.data || []).map((l) => l.attribution_id).filter(Boolean)
  const voided = []
  if (attIds.length) {
    const atts = await sb.from('affiliate_attributions').select('id, referred_user_id, payment_fingerprint, qualified_at').in('id', attIds)
    const qualifiedFps = await sb.from('affiliate_attributions').select('id, payment_fingerprint').eq('status', 'qualified').not('payment_fingerprint', 'is', null)
    const seen = new Map((qualifiedFps.data || []).map((r) => [r.payment_fingerprint, r.id]))
    const ordered = (atts.data || []).sort((a, b) => String(a.qualified_at).localeCompare(String(b.qualified_at)))
    for (const a of ordered) {
      const fp = a.payment_fingerprint || await paymentFingerprint(sb, stripe, a.referred_user_id)
      if (!fp) continue
      if (!a.payment_fingerprint) await sb.from('affiliate_attributions').update({ payment_fingerprint: fp }).eq('id', a.id)
      const owner = seen.get(fp)
      if (owner && owner !== a.id && fp.startsWith('fp:')) {
        voided.push(a.id)
        await sb.from('affiliate_attributions').update({ status: 'rejected', reject_reason: 'duplicate_payment' }).eq('id', a.id)
        await sb.from('affiliate_ledger').update({ status: 'void', note: 'duplicate payment method' }).eq('attribution_id', a.id).eq('status', 'pending')
      } else if (!owner) seen.set(fp, a.id)
    }
  }
  const voidSet = new Set(voided)
  const plan = planPayoutBatch((pending.data || []).filter((l) => !voidSet.has(l.attribution_id)), { rates })
  if (!plan.include.length) return json(res, 200, { ok: true, batch: null, voided: voided.length, rollover: plan.rollover })
  const ids = plan.include.flatMap((g) => g.entry_ids)
  const batch = await sb.from('affiliate_payout_batches').insert({
    status: 'draft', total_cents: plan.total_cents, entry_count: ids.length, created_by: user.id,
  }).select('*').single()
  if (batch.error) return json(res, 400, { error: batch.error.message })
  await sb.from('affiliate_ledger').update({ batch_id: batch.data.id }).in('id', ids).eq('status', 'pending').is('batch_id', null)
  return json(res, 200, { ok: true, batch: batch.data, groups: plan.include, rollover: plan.rollover, voided: voided.length })
}

async function batchApprove(sb, res, user, body, getStripe, key) {
  if (!UUID.test(body.batch_id || '')) return json(res, 400, { error: 'batch_id required' })
  const now = new Date().toISOString()
  const up = await sb.from('affiliate_payout_batches').update({ status: 'approved', approved_by: user.id, approved_at: now })
    .eq('id', body.batch_id).eq('status', 'draft').select('*').maybeSingle()
  if (!up.data) return json(res, 409, { error: 'Batch is not a draft' })
  await sb.from('affiliate_ledger').update({ status: 'approved', approved_at: now }).eq('batch_id', body.batch_id).eq('status', 'pending')
  const payout = await payApprovedStripe(sb, body.batch_id, getStripe, key)
  return json(res, 200, { ok: payout.ok, batch: { ...up.data, status: payout.status }, payout })
}

async function refreshConnectAccounts(sb, byId, stripe) {
  for (const affiliate of byId.values()) {
    if (affiliate.payout_method !== 'stripe_connect' || !affiliate.stripe_account_id) continue
    try {
      byId.set(affiliate.id, await refreshAffiliateConnect(sb, affiliate, stripe))
    } catch { /* keep the stored status; transfer stays gated on verified */ }
  }
}

/** After admin approval, transfer verified Connect commissions. Fraud and hold gates already ran at batch create. */
async function payApprovedStripe(sb, batchId, getStripe, key) {
  const entries = await sb.from('affiliate_ledger').select('*').eq('batch_id', batchId).eq('status', 'approved')
  const rows = entries.data || []
  const affIds = [...new Set(rows.map((e) => e.affiliate_id))]
  const affs = affIds.length ? await sb.from('affiliates').select('*').in('id', affIds) : { data: [] }
  const byId = new Map((affs.data || []).map((a) => [a.id, a]))
  const stripe = isAffiliateTestKey(key) ? getStripe() : null
  if (stripe) await refreshConnectAccounts(sb, byId, stripe)
  const transferred = await transferApprovedCommissions(sb, rows, byId, stripe, key)
  const failures = (transferred.results || []).filter((r) => !r.ok)
  const remaining = await sb.from('affiliate_ledger').select('id').eq('batch_id', batchId).eq('status', 'approved')
  let status = 'approved'
  if (failures.length) status = 'failed'
  else if (rows.length && (remaining.data || []).length === 0 && !transferred.skipped) status = 'paid'
  await sb.from('affiliate_payout_batches').update({
    status,
    paid_at: status === 'paid' ? new Date().toISOString() : null,
    result: { payout: transferred },
  }).eq('id', batchId)
  return { ok: failures.length === 0, status, ...transferred }
}

async function batchPay(sb, res, body, getStripe, key) {
  if (!UUID.test(body.batch_id || '')) return json(res, 400, { error: 'batch_id required' })
  const batch = await sb.from('affiliate_payout_batches').select('*').eq('id', body.batch_id).maybeSingle()
  if (!['approved', 'failed'].includes(batch.data?.status)) return json(res, 409, { error: 'Approve the batch first' })
  const entries = await sb.from('affiliate_ledger').select('*').eq('batch_id', body.batch_id).eq('status', 'approved')
  const affIds = [...new Set((entries.data || []).map((e) => e.affiliate_id))]
  const affs = affIds.length ? await sb.from('affiliates').select('*').in('id', affIds) : { data: [] }
  const byId = new Map((affs.data || []).map((a) => [a.id, a]))
  const credits = supabaseCreditStore(sb)
  const stripe = isAffiliateTestKey(key) ? getStripe() : null
  if (stripe) await refreshConnectAccounts(sb, byId, stripe)
  const transferred = await transferApprovedCommissions(sb, entries.data || [], byId, stripe, key)
  const results = [...(transferred.results || [])]
  if (transferred.skipped) {
    for (const e of entries.data || []) {
      if ((byId.get(e.affiliate_id)?.payout_method || 'ride_credit') !== 'stripe_connect') continue
      results.push({ id: e.id, ok: false, method: 'stripe_connect', error: 'Stripe test key required; live transfers are disabled' })
    }
  }
  for (const e of entries.data || []) {
    const a = byId.get(e.affiliate_id)
    if ((a?.payout_method || 'ride_credit') === 'stripe_connect') continue
    let ref = null
    try {
      if (!a?.user_id) throw new Error('Affiliate has no account for ride credit')
      const r = await credits.applyCredits(a.user_id, e.amount_cents, { kind: 'adjust', idempotencyKey: `affiliate:${e.id}` })
      if (!r.ok) throw new Error(r.code || 'credit failed')
      ref = `credit:${e.id}`
      await sb.from('affiliate_ledger').update({ status: 'paid', paid_at: new Date().toISOString(), payout_method: 'ride_credit', payout_ref: ref }).eq('id', e.id).eq('status', 'approved')
      results.push({ id: e.id, ok: true, method: 'ride_credit', ref })
    } catch (err) {
      results.push({ id: e.id, ok: false, method: 'ride_credit', error: err.message })
    }
  }
  const failed = results.filter((r) => !r.ok).length
  const status = failed ? 'failed' : 'paid'
  await sb.from('affiliate_payout_batches').update({ status, paid_at: failed ? null : new Date().toISOString(), result: { results } }).eq('id', body.batch_id)
  return json(res, 200, { ok: !failed, status, results })
}

async function entryVoid(sb, res, body) {
  if (!UUID.test(body.entry_id || '')) return json(res, 400, { error: 'entry_id required' })
  const up = await sb.from('affiliate_ledger').update({ status: 'void', note: String(body.note || 'voided by admin').slice(0, 200) })
    .eq('id', body.entry_id).in('status', ['pending', 'approved']).select('id').maybeSingle()
  if (!up.data) return json(res, 409, { error: 'Only pending or approved entries can be voided' })
  return json(res, 200, { ok: true })
}

export default createAffiliatesHandler()
