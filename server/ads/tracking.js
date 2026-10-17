/**
 * In-car tablet ads, part 2: QR scan tracking, partner analytics, self-serve campaigns,
 * boosts, founding-partner applications and the admin controls for them.
 * Every function takes a service-role Supabase client so tests can pass a fake.
 */
import { createHash } from 'node:crypto'
import { WEB_ORIGIN } from '../../shared/productLinks.js'
import { SCAN_DEDUPE_MINUTES, boostQuote, campaignMetrics, creativeRanking } from '../../shared/ads/metrics.js'
import { normalizeTargeting } from '../../shared/ads/targeting.js'
import { applicationRow } from '../../shared/ads/application.js'
import { normalizeSignup } from '../../shared/ads/signup.js'
import { packagePickable, publicUrl } from './service.js'

function fail(status, error, extra = {}) {
  const err = new Error(error)
  err.status = status
  Object.assign(err, extra)
  return err
}
const must = ({ data, error }, what) => {
  if (error) throw fail(500, `${what}: ${error.message || error}`)
  return data
}

/* ---------------- QR scans: /q/<token> ---------------- */

export const QR_TOKEN_RE = /^[A-Za-z0-9_-]{8,40}$/
const BOT_UA = /bot|crawler|spider|preview|facebookexternalhit|slackbot|whatsapp|discordbot|linkedinbot|embedly|curl|wget|python-requests|headless/i

export function safeDestination(url) {
  try {
    const u = new URL(String(url || ''))
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null
  } catch {
    return null
  }
}

export function clientIp(req) {
  const fwd = String(req?.headers?.['x-forwarded-for'] || '').split(',')[0].trim()
  return fwd || req?.socket?.remoteAddress || ''
}

/** Salted, daily-rotating visitor hash. Never stored raw; used only to de-duplicate scans. */
export function visitorHash({ ip = '', userAgent = '', now = new Date(), salt = process.env.ADS_QR_SALT || 'clemson-rides-ad-qr' } = {}) {
  const day = now.toISOString().slice(0, 10)
  return createHash('sha256').update(`${salt}:${day}:${ip}:${userAgent}`).digest('hex').slice(0, 32)
}

/**
 * Log one scan and return where to send the rider. Unknown tokens go to /advertise.
 * Bots and link previewers are redirected but not counted. Repeat scans from the same phone
 * within SCAN_DEDUPE_MINUTES are stored with duplicate = true and not counted.
 */
export async function recordQrScan(sb, token, { userAgent = '', ip = '', now = new Date(), allowLog = true } = {}) {
  const fallback = `${WEB_ORIGIN}/advertise`
  if (!QR_TOKEN_RE.test(String(token || ''))) return { location: fallback, logged: false, reason: 'bad_token' }
  const { data: row, error } = await sb.from('ad_qr_tokens').select('*').eq('token', token).maybeSingle()
  if (error || !row) return { location: fallback, logged: false, reason: 'unknown_token' }
  const location = safeDestination(row.destination_url) || fallback
  const ua = String(userAgent || '').slice(0, 300)
  if (!allowLog) return { location, logged: false, reason: 'rate_limited' }
  if (BOT_UA.test(ua)) return { location, logged: false, reason: 'bot' }
  const hash = visitorHash({ ip, userAgent: ua, now })
  const since = new Date(now.getTime() - SCAN_DEDUPE_MINUTES * 60_000).toISOString()
  const { data: prior } = await sb.from('ad_qr_scans').select('id').eq('token', token).eq('visitor_hash', hash).gte('scanned_at', since).limit(1)
  const duplicate = Boolean(prior && prior.length)
  const { error: insErr } = await sb.from('ad_qr_scans').insert({
    token,
    campaign_id: row.campaign_id,
    creative_id: row.creative_id || null,
    partner_id: row.partner_id || null,
    device_id: row.device_id || null,
    trip_id: row.trip_id || null,
    scanned_at: now.toISOString(),
    user_agent: ua || null,
    visitor_hash: hash,
    duplicate,
  })
  if (insErr) console.error('[ads] qr scan log', insErr.message || insErr)
  return { location, logged: !insErr, duplicate }
}

/* ---------------- Analytics ---------------- */

async function trackingRows(sb, campaignIds) {
  if (!campaignIds.length) return { impressions: [], rideCounts: [], scans: [], boosts: [] }
  const [imp, rides, scans, boosts] = await Promise.all([
    sb.from('ad_impressions').select('campaign_id, creative_id, trip_id, seconds_shown, visible, shown_at').in('campaign_id', campaignIds).limit(100000),
    sb.from('ad_ride_counts').select('campaign_id, trip_id, counted_at').in('campaign_id', campaignIds).limit(100000),
    sb.from('ad_qr_scans').select('campaign_id, creative_id, trip_id, scanned_at, duplicate').in('campaign_id', campaignIds).limit(100000),
    sb.from('ad_campaign_boosts').select('*').in('campaign_id', campaignIds),
  ])
  return {
    impressions: must(imp, 'impressions') || [],
    rideCounts: must(rides, 'ride counts') || [],
    scans: must(scans, 'scans') || [],
    boosts: boosts.error ? [] : boosts.data || [],
  }
}

/** Campaigns with metrics, ride lists, creative ranking and boosts attached. */
export async function withAnalytics(sb, campaigns = []) {
  const ids = campaigns.map((c) => c.id)
  const rows = await trackingRows(sb, ids)
  const by = (list, id) => list.filter((r) => r.campaign_id === id)
  const allCreatives = campaigns.flatMap((c) => c.ad_creatives || [])
  const out = campaigns.map((c) => {
    const impressions = by(rows.impressions, c.id)
    const scans = by(rows.scans, c.id)
    return {
      ...c,
      metrics: campaignMetrics({ campaign: c, impressions, rideCounts: by(rows.rideCounts, c.id), scans }),
      creativeRanking: creativeRanking({ creatives: c.ad_creatives || [], impressions, scans }),
      boosts: by(rows.boosts, c.id),
      boostQuote: boostQuote(c),
    }
  })
  return { campaigns: out, creativeRanking: creativeRanking({ creatives: allCreatives, impressions: rows.impressions, scans: rows.scans }) }
}

/** A partner is onboarded (may self-serve) once John activates them. */
export const partnerOnboarded = (p) => p?.status === 'active'

/** Signed-in partner dashboard: own partners and campaigns with live counters. */
export async function partnerDashboard(sb, user) {
  if (user?.email) {
    await sb.from('ad_partners').update({ profile_id: user.id }).is('profile_id', null).eq('email', String(user.email).toLowerCase())
  }
  const partners = must(await sb.from('ad_partners').select('*').eq('profile_id', user.id), 'partners') || []
  if (!partners.length) return { partners: [], campaigns: [], creativeRanking: [], onboarded: false, refreshedAt: new Date().toISOString() }
  const campaigns = must(await sb.from('ad_campaigns').select('*, ad_creatives(*), ad_packages(id, name, kind, rides_included, price_cents)').in('partner_id', partners.map((p) => p.id)).order('created_at', { ascending: false }), 'campaigns') || []
  const a = await withAnalytics(sb, campaigns)
  return {
    partners: partners.map(({ stripe_customer_id: _s, notes: _n, ...p }) => p),
    onboarded: partners.some(partnerOnboarded),
    campaigns: a.campaigns,
    creativeRanking: a.creativeRanking,
    refreshedAt: new Date().toISOString(),
  }
}

/* ---------------- Partner self-serve ---------------- */

export async function ownPartner(sb, user, partnerId) {
  const partners = must(await sb.from('ad_partners').select('*').eq('profile_id', user.id), 'partners') || []
  const p = partnerId ? partners.find((x) => x.id === partnerId) : (partners.find(partnerOnboarded) || partners[0])
  if (!p) throw fail(403, 'No partner account for this sign-in.')
  if (!partnerOnboarded(p)) throw fail(403, 'Your partner account is not active yet. We will email you when it is.')
  return p
}

export async function ownCampaign(sb, user, campaignId) {
  const c = must(await sb.from('ad_campaigns').select('*, ad_creatives(*), ad_partners(*)').eq('id', campaignId).maybeSingle(), 'campaign')
  if (!c || c.ad_partners?.profile_id !== user.id) throw fail(404, 'Campaign not found')
  return c
}

const URLISH = /^https:\/\/[^\s]+\.[^\s]{2,}$/i

export function partnerCampaignErrors(b = {}) {
  const e = {}
  if (!b.packageId) e.packageId = 'Pick a ride bundle.'
  if (b.destinationUrl && !URLISH.test(String(b.destinationUrl).trim())) e.destinationUrl = 'Use a full https:// link.'
  const mode = b.creativeMode || (b.creativeId ? 'existing' : '')
  if (!['build', 'upload', 'existing'].includes(mode)) e.creativeMode = 'Build your ad, upload one, or pick an existing ad.'
  if (mode === 'build') {
    if (String(b.headline || '').trim().length < 2) e.headline = 'Add a headline.'
    if (String(b.dealText || '').trim().length < 3) e.dealText = 'Add the deal riders should see.'
  }
  if (mode === 'upload' && !/^(pending\/[0-9a-f-]{36}|copilot\/[\w-]{1,40})\/[\w.-]{1,120}$/i.test(String(b.storagePath || ''))) e.storagePath = 'Upload an image or video.'
  return e
}

/**
 * Build My Ad + Create My Campaign + Launch My Campaign.
 * body: { id?, packageId, creativeMode build|upload|existing, headline, dealText, theme, storagePath,
 *         contentType, creativeId, destinationUrl, targeting, gameDayBoost, launch }
 * Save keeps status draft. Launch moves to pending_payment (billing is flagged off) and sends the
 * creative to review, unless John turned on auto-approve for this partner.
 */
export async function partnerSaveCampaign(sb, user, body = {}, { now = new Date() } = {}) {
  const errors = partnerCampaignErrors(body)
  if (Object.keys(errors).length) throw fail(400, 'Fix the highlighted fields.', { errors })
  const partner = await ownPartner(sb, user, body.partnerId)
  if (String(body.storagePath || '').startsWith('copilot/') && !String(body.storagePath).startsWith(`copilot/${partner.id}/`)) {
    throw fail(400, 'Upload an image or video.', { errors: { storagePath: 'Upload an image or video.' } })
  }
  const pkg = must(await sb.from('ad_packages').select('*').eq('id', body.packageId).maybeSingle(), 'package')
  if (!packagePickable(pkg) || pkg.kind === 'addon') throw fail(400, 'Pick an available ride bundle.', { errors: { packageId: 'Pick an available ride bundle.' } })

  let campaign = null
  if (body.id) {
    campaign = await ownCampaign(sb, user, body.id)
    if (campaign.status !== 'draft') throw fail(409, 'Only draft campaigns can be edited.')
  }
  const patch = {
    partner_id: partner.id,
    package_id: pkg.id,
    name: `${partner.business_name} · ${pkg.name}`,
    rides_purchased: pkg.rides_included || null,
    price_cents: pkg.price_cents || null,
    destination_url: body.destinationUrl ? String(body.destinationUrl).trim().slice(0, 500) : null,
    targeting: normalizeTargeting(body.targeting),
    game_day_boost: body.gameDayBoost === true,
    updated_at: now.toISOString(),
  }
  if (body.launch) {
    patch.status = 'pending_payment'
    patch.launched_at = now.toISOString()
  }
  campaign = campaign
    ? must(await sb.from('ad_campaigns').update(patch).eq('id', campaign.id).select('*').single(), 'campaign')
    : must(await sb.from('ad_campaigns').insert({ ...patch, status: body.launch ? 'pending_payment' : 'draft' }).select('*').single(), 'campaign')

  const approval = body.launch && partner.auto_approve_creatives ? 'approved' : 'pending_review'
  let creative = null
  const mode = body.creativeMode || (body.creativeId ? 'existing' : '')
  if (mode === 'existing') {
    const src = must(await sb.from('ad_creatives').select('*, ad_campaigns(partner_id)').eq('id', body.creativeId).maybeSingle(), 'creative')
    if (!src || src.ad_campaigns?.partner_id !== partner.id) throw fail(404, 'Ad not found')
    const { id: _id, ad_campaigns: _c, created_at: _ca, reviewed_at: _r, review_note: _n, ...copy } = src
    const keepApproved = src.approval_status === 'approved'
    creative = must(await sb.from('ad_creatives').insert({ ...copy, campaign_id: campaign.id, approval_status: keepApproved ? 'approved' : approval, updated_at: now.toISOString() }).select('*').single(), 'creative')
  } else {
    const v = normalizeSignup({ ...body, businessName: partner.business_name, creativeMode: mode })
    const row = mode === 'upload'
      ? { kind: v.storagePath && /video/.test(v.contentType) ? 'video' : 'image', storage_path: v.storagePath, media_url: publicUrl(sb, v.storagePath) }
      : { kind: 'built' }
    const existing = must(await sb.from('ad_creatives').select('id').eq('campaign_id', campaign.id), 'creatives') || []
    const fields = { ...row, headline: v.headline || partner.business_name, deal_text: v.dealText || null, qr_url: patch.destination_url, logo_url: partner.logo_url || null, theme: v.theme, approval_status: approval, updated_at: now.toISOString() }
    creative = existing.length
      ? must(await sb.from('ad_creatives').update(fields).eq('id', existing[0].id).select('*').single(), 'creative')
      : must(await sb.from('ad_creatives').insert({ campaign_id: campaign.id, ...fields }).select('*').single(), 'creative')
  }
  return { campaign, creative, autoApproved: approval === 'approved' && body.launch === true }
}

/** Launch an existing draft as-is. */
export async function partnerLaunchCampaign(sb, user, { id } = {}, { now = new Date() } = {}) {
  const c = await ownCampaign(sb, user, id)
  if (c.status !== 'draft') throw fail(409, 'Only drafts can be launched.')
  const partner = c.ad_partners
  if (!partnerOnboarded(partner)) throw fail(403, 'Your partner account is not active yet.')
  if (!(c.ad_creatives || []).length) throw fail(400, 'Add an ad before you launch.')
  const campaign = must(await sb.from('ad_campaigns').update({ status: 'pending_payment', launched_at: now.toISOString(), updated_at: now.toISOString() }).eq('id', c.id).select('*').single(), 'campaign')
  if (partner.auto_approve_creatives) {
    await sb.from('ad_creatives').update({ approval_status: 'approved', reviewed_at: now.toISOString(), review_note: 'auto-approved (partner setting)' }).eq('campaign_id', c.id).eq('approval_status', 'pending_review')
  }
  return { campaign }
}

/** Boost: quote first (confirm=false), then record a pending_payment add-on (confirm=true). */
export async function partnerBoost(sb, user, { campaignId, confirm = false } = {}, { now = new Date() } = {}) {
  const c = await ownCampaign(sb, user, campaignId)
  const quote = boostQuote(c)
  if (!quote.ok) throw fail(409, quote.reason)
  if (!confirm) return { quote }
  const open = must(await sb.from('ad_campaign_boosts').select('id').eq('campaign_id', c.id).eq('status', 'pending_payment'), 'boosts') || []
  if (open.length) throw fail(409, 'A boost for this campaign is already waiting for payment.')
  const boost = must(await sb.from('ad_campaign_boosts').insert({
    campaign_id: c.id,
    partner_id: c.partner_id,
    rides_added: quote.ridesAdded,
    per_ride_cents: quote.perRideCents,
    price_cents: quote.priceCents,
    status: 'pending_payment',
    created_at: now.toISOString(),
  }).select('*').single(), 'boost')
  return { quote, boost }
}

/* ---------------- Founding-partner applications ---------------- */

export async function submitApplication(sb, body = {}) {
  return must(await sb.from('ad_partner_applications').insert(applicationRow(body)).select('id, status, business_name').single(), 'application')
}

/** John approves or declines. Approval creates or updates the partner with founding rates unlocked. */
export async function adminApplication(sb, { id, decision, note } = {}, { now = new Date() } = {}) {
  if (!['approved', 'declined'].includes(decision)) throw fail(400, 'Decision must be approved or declined')
  const app = must(await sb.from('ad_partner_applications').select('*').eq('id', id).maybeSingle(), 'application')
  if (!app) throw fail(404, 'Application not found')
  let partner = null
  if (decision === 'approved') {
    const found = must(await sb.from('ad_partners').select('*').eq('email', app.email), 'partners') || []
    const fields = { founding_approved: true, status: 'active', address: app.address, category: app.category, website: app.website, updated_at: now.toISOString() }
    partner = found[0]
      ? must(await sb.from('ad_partners').update(fields).eq('id', found[0].id).select('*').single(), 'partner')
      : must(await sb.from('ad_partners').insert({ business_name: app.business_name, contact_name: app.contact_name, email: app.email, phone: app.phone, ...fields }).select('*').single(), 'partner')
  }
  const updated = must(await sb.from('ad_partner_applications').update({
    status: decision, partner_id: partner?.id || app.partner_id || null, review_note: note ? String(note).slice(0, 500) : null, reviewed_at: now.toISOString(),
  }).eq('id', app.id).select('*').single(), 'application')
  return { application: updated, partner }
}

/* ---------------- Admin: partners and boosts ---------------- */

const PARTNER_EDITABLE = ['status', 'auto_approve_creatives', 'founding_approved', 'address', 'lat', 'lng', 'notes']

export async function adminPartner(sb, b = {}, { now = new Date() } = {}) {
  if (!b.id) throw fail(400, 'Partner id required')
  const patch = { updated_at: now.toISOString() }
  for (const k of PARTNER_EDITABLE) if (b[k] !== undefined) patch[k] = b[k] === '' ? null : b[k]
  if (patch.status && !['pending', 'active', 'suspended'].includes(patch.status)) throw fail(400, 'Unknown partner status')
  for (const k of ['auto_approve_creatives', 'founding_approved']) if (k in patch) patch[k] = patch[k] === true
  for (const k of ['lat', 'lng']) if (patch[k] != null) { const n = Number(patch[k]); if (!Number.isFinite(n)) throw fail(400, `${k} must be a number`); patch[k] = n }
  return must(await sb.from('ad_partners').update(patch).eq('id', b.id).select('*').single(), 'partner')
}

/** Apply (adds the rides to the campaign) or cancel a boost. Apply is idempotent. */
export async function adminBoost(sb, { id, action } = {}, { now = new Date() } = {}) {
  const boost = must(await sb.from('ad_campaign_boosts').select('*').eq('id', id).maybeSingle(), 'boost')
  if (!boost) throw fail(404, 'Boost not found')
  if (action === 'cancel') {
    if (boost.status === 'applied') throw fail(409, 'Applied boosts cannot be canceled')
    return { boost: must(await sb.from('ad_campaign_boosts').update({ status: 'canceled' }).eq('id', id).select('*').single(), 'boost') }
  }
  if (action !== 'apply') throw fail(400, 'Unknown boost action')
  if (boost.status === 'applied') return { boost, already: true }
  if (boost.status === 'canceled') throw fail(409, 'Canceled boosts cannot be applied')
  const c = must(await sb.from('ad_campaigns').select('*').eq('id', boost.campaign_id).maybeSingle(), 'campaign')
  const patch = { rides_purchased: Number(c.rides_purchased || 0) + boost.rides_added, price_cents: Number(c.price_cents || 0) + boost.price_cents, updated_at: now.toISOString() }
  if (c.status === 'ended' && c.ended_reason === 'rides_reached') { patch.status = 'active'; patch.ended_reason = null }
  const campaign = must(await sb.from('ad_campaigns').update(patch).eq('id', c.id).select('*').single(), 'campaign')
  const applied = must(await sb.from('ad_campaign_boosts').update({ status: 'applied', applied_at: now.toISOString() }).eq('id', id).select('*').single(), 'boost')
  return { boost: applied, campaign }
}

export async function adminTracking(sb, campaigns = []) {
  const [apps, a] = await Promise.all([
    sb.from('ad_partner_applications').select('*').order('created_at', { ascending: false }).limit(300),
    withAnalytics(sb, campaigns),
  ])
  return { applications: apps.error ? [] : apps.data || [], campaigns: a.campaigns, creativeRanking: a.creativeRanking }
}
