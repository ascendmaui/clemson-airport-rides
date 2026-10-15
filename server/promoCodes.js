/**
 * Promo code service: every check and every write is server-side, through
 * service-role RPCs that lock the code row (see the 20261015160000 migration).
 * Pure math and copy live in shared/promoCodes.js.
 */
import { randomUUID } from 'node:crypto'
import { isPayoutApprover } from '../shared/payoutApproval.js'
import { stripeClient, stripeOk } from './friendRideLib.js'
import {
  choosePromoOrRecurring,
  normalizePromoCode,
  planPromoCodes,
  PROMO_AUTO_DEFAULTS,
  PROMO_LIMITS,
  promoCodesCsv,
  promoDiscountCents,
  promoReasonMessage,
  promoTripSnapshot,
  publicCampaignRow,
  validatePromoDefinition,
} from '../shared/promoCodes.js'

const MISSING = /schema cache|does not exist|could not find the (table|function)/i

/**
 * The promo admin is the sole owner account (johnmatveyev@gmail.com with a
 * confirmed email), the same hard-coded identity as the payout approver.
 * An env list, profile role or is_admin flag cannot widen it.
 */
export function isPromoAdmin(user) {
  return isPayoutApprover(user)
}

/** Client device id: letters, digits, dash, 8–128 chars. Anything else is ignored. */
export function cleanDeviceId(raw) {
  const value = String(raw || '').trim()
  return /^[A-Za-z0-9-]{8,128}$/.test(value) ? value : null
}

function rpcResult(result, fallback = 'promo_unavailable') {
  if (result?.error) {
    if (MISSING.test(result.error.message || '')) return { ok: false, reason: 'promo_unavailable' }
    throw new Error(result.error.message || fallback)
  }
  const data = result?.data
  return data && typeof data === 'object' ? data : { ok: false, reason: fallback }
}

function withMessage(result) {
  if (result?.ok) return result
  return { ...result, message: promoReasonMessage(result?.reason) }
}

export async function checkPromo(sb, { userId, code, side = 'rider', fareCents = null }) {
  const norm = normalizePromoCode(code)
  if (!norm) return withMessage({ ok: false, reason: 'no_code' })
  return withMessage(rpcResult(await sb.rpc('promo_check_code', {
    p_profile: userId, p_code: norm, p_side: side, p_fare_cents: fareCents == null ? null : Math.round(fareCents),
  })))
}

export async function claimPromo(sb, { userId, code, side = 'rider', deviceId = null }) {
  const norm = normalizePromoCode(code)
  if (!norm) return withMessage({ ok: false, reason: 'no_code' })
  return withMessage(rpcResult(await sb.rpc('promo_claim_code', {
    p_profile: userId, p_code: norm, p_side: side, p_device_id: cleanDeviceId(deviceId),
  })))
}

export async function reservePromoForTrip(sb, { userId, code = null, tripId, fareCents, deviceId = null, cardFingerprint = null }) {
  return withMessage(rpcResult(await sb.rpc('promo_reserve_for_trip', {
    p_profile: userId,
    p_code: normalizePromoCode(code) || null,
    p_trip_id: tripId,
    p_fare_cents: Math.max(0, Math.round(Number(fareCents) || 0)),
    p_device_id: cleanDeviceId(deviceId),
    p_card_fingerprint: cardFingerprint || null,
  })))
}

export async function releasePromoForTrip(sb, tripId, reason = 'trip_not_created') {
  if (!sb || !tripId) return { ok: true, skipped: true }
  try {
    return rpcResult(await sb.rpc('promo_release_for_trip', { p_trip_id: tripId, p_reason: reason }))
  } catch (err) {
    console.error('[promo] release', err?.message || err)
    return { ok: false, reason: 'release_failed' }
  }
}

/** Best-effort after capture; the trips status trigger also marks it redeemed. */
export async function finalizePromoForTrip(sb, { tripId, discountCents, fareCents }) {
  if (!sb?.rpc || !tripId) return { ok: true, skipped: true }
  try {
    return rpcResult(await sb.rpc('promo_finalize_for_trip', {
      p_trip_id: tripId,
      p_discount_cents: Math.max(0, Math.round(Number(discountCents) || 0)),
      p_fare_cents: fareCents == null ? null : Math.max(0, Math.round(Number(fareCents) || 0)),
    }))
  } catch (err) {
    console.error('[promo] finalize', err?.message || err)
    return { ok: false, reason: 'finalize_failed' }
  }
}

/** Stripe card fingerprint of the rider's default card, for one-per-card limits. Never logged. */
export async function defaultCardFingerprint({ sb, stripe, userId }) {
  if (!sb || !stripe?.paymentMethods?.retrieve || !userId) return null
  try {
    const row = await sb.from('profiles').select('stripe_default_pm_id').eq('id', userId).maybeSingle()
    const pm = row?.data?.stripe_default_pm_id
    if (!pm) return null
    const method = await stripe.paymentMethods.retrieve(pm)
    const fp = method?.card?.fingerprint
    return typeof fp === 'string' && fp.length <= 64 ? fp : null
  } catch {
    return null
  }
}

/** Oldest still-usable rider code claimed at signup, for a preview. */
async function claimedSignupPromo(sb, userId, now = new Date()) {
  const res = await sb.from('promo_code_redemptions')
    .select('id, code, code_id, created_at')
    .eq('profile_id', userId).eq('status', 'claimed').eq('side', 'rider')
    .order('created_at', { ascending: true }).limit(10)
  if (res?.error) {
    if (MISSING.test(res.error.message || '')) return null
    throw new Error(res.error.message)
  }
  // Same order as promo_reserve_for_trip: the soonest-expiring code goes first.
  const live = []
  for (const claim of res?.data || []) {
    const code = await sb.from('promo_campaign_codes').select('*').eq('id', claim.code_id).maybeSingle()
    const row = code?.data
    if (!row || !row.active) continue
    if (new Date(row.expires_at) <= now || new Date(row.starts_at) > now) continue
    live.push(row)
  }
  live.sort((a, b) => new Date(a.expires_at) - new Date(b.expires_at))
  return live[0] || null
}

/**
 * Decide the promo for an on-demand ride request before the trip row exists.
 * recurring: the server price with student / Tiger Pass. list: same ride
 * without them. Applies the no-stack rule, then reserves atomically against
 * a pre-allocated trip id. Returns { tripId, priced, promo, snapshot }.
 */
export async function applyPromoToRideRequest({
  sb, stripe, userId, code = null, deviceId = null, recurring, list, now = new Date(),
}) {
  const tripId = randomUUID()
  const typed = normalizePromoCode(code)
  const base = { tripId, priced: recurring, promo: null, snapshot: null }
  if (!sb?.rpc || !userId || !list) return base
  try {
    const listFare = Math.max(0, Math.round(Number(list.fareCents) || 0))
    let discount = 0
    if (typed) {
      const check = await checkPromo(sb, { userId, code: typed, side: 'rider', fareCents: listFare })
      if (!check.ok) return { ...base, promo: { applied: false, code: typed, reason: check.reason, message: check.message } }
      discount = Math.max(0, Number(check.discount_cents) || 0)
    } else {
      const claimed = await claimedSignupPromo(sb, userId, now)
      if (!claimed) return base
      discount = promoDiscountCents(claimed, listFare)
    }
    const decision = choosePromoOrRecurring({
      recurringFareCents: recurring.fareCents,
      listFareCents: listFare,
      promoDiscountCents: discount,
    })
    if (!decision.usePromo) {
      return typed
        ? { ...base, promo: { applied: false, code: typed, reason: decision.reason, message: promoReasonMessage(decision.reason) } }
        : base
    }
    const cardFingerprint = await defaultCardFingerprint({
      sb, stripe: stripe || (stripeOk() ? stripeClient() : null), userId,
    })
    const reserved = await reservePromoForTrip(sb, {
      userId, code: typed || null, tripId, fareCents: listFare, deviceId, cardFingerprint,
    })
    if (!reserved.ok) {
      return typed || reserved.reason !== 'no_code'
        ? { ...base, promo: { applied: false, code: typed || null, reason: reserved.reason, message: reserved.message } }
        : base
    }
    const snapshot = promoTripSnapshot(reserved, { listFareCents: listFare, recurringFareCents: recurring.fareCents })
    return {
      tripId,
      priced: list,
      snapshot,
      promo: {
        applied: true,
        code: reserved.code,
        discountCents: snapshot.estimated_discount_cents,
        fareCents: listFare,
        riderPaysCents: Math.max(0, listFare - snapshot.estimated_discount_cents),
        fundedBy: 'platform',
        message: `${reserved.code} saves about $${(snapshot.estimated_discount_cents / 100).toFixed(2)} on this ride. The final discount is set on the final fare.`,
      },
    }
  } catch (err) {
    console.error('[promo] apply', err?.message || err)
    return { ...base, promo: typed ? { applied: false, code: typed, reason: 'promo_unavailable', message: promoReasonMessage('promo_unavailable') } : null }
  }
}

// ---------------------------------------------------------------------------
// Admin (johnmatveyev@gmail.com only; the endpoint checks isPromoAdmin first)
// ---------------------------------------------------------------------------

async function audit(sb, { action, actor, codeId = null, batchId = null, detail = {} }) {
  try {
    await sb.from('promo_code_admin_events').insert({
      action, code_id: codeId, batch_id: batchId, actor_id: actor?.id || null, actor_email: actor?.email || null, detail,
    })
  } catch (err) {
    console.error('[promo] audit', err?.message || err)
  }
}

/** Admin-made codes by default. Auto-issued codes (one per account per trigger) only on request. */
export async function listPromoCodes(sb, { limit = 500, includeAuto = false } = {}) {
  let query = sb.from('promo_campaign_codes').select('*')
  if (!includeAuto) query = query.eq('source', 'admin')
  const codes = await query.order('created_at', { ascending: false }).limit(limit)
  if (codes?.error) throw new Error(codes.error.message)
  const rows = codes.data || []
  const counts = new Map()
  if (rows.length) {
    const used = await sb.from('promo_code_redemptions').select('code_id, status, discount_cents')
      .in('code_id', rows.map((r) => r.id)).in('status', ['claimed', 'reserved', 'redeemed'])
    if (used?.error) throw new Error(used.error.message)
    for (const r of used.data || []) {
      const c = counts.get(r.code_id) || { claimed: 0, reserved: 0, redeemed: 0, discountCents: 0 }
      c[r.status] += 1
      if (r.status !== 'claimed') c.discountCents += Math.max(0, Number(r.discount_cents) || 0)
      counts.set(r.code_id, c)
    }
  }
  return rows.map((row) => ({ ...row, counts: counts.get(row.id) || { claimed: 0, reserved: 0, redeemed: 0, discountCents: 0 } }))
}

export async function createPromoCodes(sb, { actor, input = {}, now = new Date(), random } = {}) {
  const def = validatePromoDefinition(input, { now })
  if (!def.ok) return { ok: false, status: 400, error: def.errors.join('; '), errors: def.errors }
  const plan = planPromoCodes({ code: input.code, prefix: input.prefix, count: input.count }, random)
  if (!plan.ok) return { ok: false, status: 400, error: plan.error }
  const batchId = randomUUID()
  const rows = plan.codes.map((code) => ({
    ...def.row, code, batch_id: batchId, created_by: actor?.id || null, created_by_email: actor?.email || null,
  }))
  // One insert statement: the whole batch lands or none of it does.
  const inserted = await sb.from('promo_campaign_codes').insert(rows).select('*')
  if (inserted?.error) {
    const taken = String(inserted.error.code) === '23505' || /promo_code_taken|duplicate/i.test(inserted.error.message || '')
    return { ok: false, status: taken ? 409 : 500, error: taken ? 'That code is already in use. Pick another.' : 'Could not create codes' }
  }
  await audit(sb, { action: 'created', actor, batchId, detail: { count: rows.length, side: def.row.side, discount_type: def.row.discount_type } })
  return { ok: true, batchId, codes: inserted.data || [] }
}

/** Only safe fields change after creation. Discount terms are frozen once issued. */
// max_redemptions is not here: every code is single-use.
const UPDATABLE = {
  active: 'active',
  expiresAt: 'expires_at',
  publicListing: 'public_listing',
  notes: 'notes',
  campaign: 'campaign',
  budgetCents: 'budget_cents',
}

function updateErrors(changes, current, now) {
  const errors = []
  if ('expires_at' in changes) {
    const at = new Date(changes.expires_at)
    const start = new Date(current.starts_at)
    if (Number.isNaN(at.getTime())) errors.push('expiration is not a date')
    else {
      if (at <= now && changes.active !== false) errors.push('expiration must be in the future')
      if (at <= start) errors.push('expiration must be after the start')
      if (at.getTime() - start.getTime() > PROMO_LIMITS.maxLifetimeDays * 86400000) errors.push(`a code can live at most ${PROMO_LIMITS.maxLifetimeDays} days`)
      changes.expires_at = at.toISOString()
    }
  }
  if ('budget_cents' in changes && changes.budget_cents != null) {
    const n = Math.round(Number(changes.budget_cents))
    if (!Number.isFinite(n) || n < 1 || n > PROMO_LIMITS.maxBudgetCents) errors.push('budget is out of range')
    changes.budget_cents = n
  }
  if ('active' in changes) changes.active = changes.active === true
  if ('public_listing' in changes) changes.public_listing = changes.public_listing === true
  if ('notes' in changes) changes.notes = changes.notes == null ? null : String(changes.notes).slice(0, 500)
  if ('campaign' in changes) changes.campaign = changes.campaign == null ? null : String(changes.campaign).slice(0, 80)
  return errors
}

export async function updatePromoCode(sb, { actor, id, patch = {}, now = new Date() } = {}) {
  if (!id) return { ok: false, status: 400, error: 'id_required' }
  const changes = {}
  const blocked = []
  for (const [key, value] of Object.entries(patch || {})) {
    const column = UPDATABLE[key] || (Object.values(UPDATABLE).includes(key) ? key : null)
    if (!column) blocked.push(key)
    else changes[column] = value
  }
  if (blocked.length) return { ok: false, status: 400, error: `These fields cannot change after a code is issued: ${blocked.join(', ')}` }
  if (!Object.keys(changes).length) return { ok: false, status: 400, error: 'nothing_to_update' }
  const current = await sb.from('promo_campaign_codes').select('*').eq('id', id).maybeSingle()
  if (current?.error) throw new Error(current.error.message)
  if (!current?.data) return { ok: false, status: 404, error: 'not_found' }
  const errors = updateErrors(changes, current.data, now)
  if (errors.length) return { ok: false, status: 400, error: errors.join('; ') }
  const updated = await sb.from('promo_campaign_codes').update({ ...changes, updated_at: now.toISOString() }).eq('id', id).select('*').maybeSingle()
  if (updated?.error) throw new Error(updated.error.message)
  await audit(sb, { action: changes.active === false ? 'deactivated' : 'updated', actor, codeId: id, detail: { fields: Object.keys(changes) } })
  return { ok: true, code: updated.data }
}

export async function exportPromoCodes(sb, { actor, campaign = null, includeAuto = false } = {}) {
  let rows = await listPromoCodes(sb, { limit: 5000, includeAuto })
  if (campaign) rows = rows.filter((row) => row.campaign === campaign)
  await audit(sb, { action: 'exported', actor, detail: { count: rows.length, campaign, includeAuto } })
  return { csv: promoCodesCsv(rows), count: rows.length }
}

/** Marketing feed: opt-in (public_listing) rider codes that are live now. */
export async function publicCampaigns(sb, { now = new Date() } = {}) {
  const res = await sb.from('promo_campaign_codes').select('*')
    .eq('public_listing', true).eq('active', true).eq('side', 'rider').eq('source', 'admin')
    .lte('starts_at', now.toISOString()).gt('expires_at', now.toISOString())
    .order('expires_at', { ascending: true }).limit(50)
  if (res?.error) {
    if (MISSING.test(res.error.message || '')) return []
    throw new Error(res.error.message)
  }
  return (res.data || []).map(publicCampaignRow)
}

// ---------------------------------------------------------------------------
// Auto-issued codes: settings (promo_auto_settings, one row)
// ---------------------------------------------------------------------------

function autoSettingsView(row) {
  const r = row || {}
  return {
    issueEnabled: r.issue_enabled !== false,
    percentOff: (r.percent_off_bps ?? PROMO_AUTO_DEFAULTS.percentOffBps) / 100,
    maxDiscountCents: r.max_discount_cents ?? PROMO_AUTO_DEFAULTS.maxDiscountCents,
    expiresDays: r.expires_days ?? PROMO_AUTO_DEFAULTS.expiresDays,
    creditThresholdCents: Number(r.credit_threshold_cents ?? PROMO_AUTO_DEFAULTS.creditThresholdCents),
    updatedAt: r.updated_at || null,
    updatedByEmail: r.updated_by_email || null,
  }
}

export async function getAutoSettings(sb) {
  const res = await sb.from('promo_auto_settings').select('*').eq('id', true).maybeSingle()
  if (res?.error) {
    if (MISSING.test(res.error.message || '')) return { ...autoSettingsView(null), unavailable: true }
    throw new Error(res.error.message)
  }
  return autoSettingsView(res?.data)
}

/** Validated patch. Changes apply to codes issued after the save; issued codes keep their terms. */
export function autoSettingsPatch(input = {}) {
  const errors = []
  const patch = {}
  if ('issueEnabled' in input) patch.issue_enabled = input.issueEnabled === true
  if ('percentOff' in input) {
    const bps = Math.round(Number(input.percentOff) * 100)
    if (!Number.isFinite(bps) || bps < 1 || bps > PROMO_LIMITS.maxPercentBps) errors.push('percent off must be 1 to 50')
    else patch.percent_off_bps = bps
  }
  if ('maxDiscountCents' in input) {
    const raw = input.maxDiscountCents
    if (raw == null || raw === '' || raw === 0) patch.max_discount_cents = null
    else {
      const n = Math.round(Number(raw))
      if (!Number.isFinite(n) || n < 1 || n > 50000) errors.push('max discount must be $0.01 to $500, or empty for no cap')
      else patch.max_discount_cents = n
    }
  }
  if ('expiresDays' in input) {
    const n = Math.round(Number(input.expiresDays))
    if (!Number.isFinite(n) || n < 1 || n > PROMO_LIMITS.maxLifetimeDays) errors.push(`expiry must be 1 to ${PROMO_LIMITS.maxLifetimeDays} days`)
    else patch.expires_days = n
  }
  if ('creditThresholdCents' in input) {
    const n = Math.round(Number(input.creditThresholdCents))
    if (!Number.isFinite(n) || n < 100 || n > 10000000) errors.push('credit threshold is out of range')
    else patch.credit_threshold_cents = n
  }
  if (!errors.length && !Object.keys(patch).length) errors.push('nothing_to_update')
  return errors.length ? { ok: false, errors } : { ok: true, patch }
}

export async function updateAutoSettings(sb, { actor, input = {}, now = new Date() } = {}) {
  const checked = autoSettingsPatch(input)
  if (!checked.ok) return { ok: false, status: 400, error: checked.errors.join('; '), errors: checked.errors }
  const res = await sb.from('promo_auto_settings')
    .update({ ...checked.patch, updated_by_email: actor?.email || null, updated_at: now.toISOString() })
    .eq('id', true).select('*').maybeSingle()
  if (res?.error) throw new Error(res.error.message)
  await audit(sb, { action: 'updated', actor, detail: { auto_settings: Object.keys(checked.patch) } })
  return { ok: true, settings: autoSettingsView(res?.data) }
}
