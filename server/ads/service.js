/**
 * In-car tablet ads: partner sign-up, admin desk, tablet feed and impressions.
 * Every function takes a service-role Supabase client so tests can pass a fake.
 */
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { buildLoop, campaignsToEnd, isGameDay } from '../../shared/ads/rotation.js'
import { FOUNDING_PACKAGE, UPLOAD_TYPES, normalizeSignup, uploadPathFor } from '../../shared/ads/signup.js'
import { tripMatchesTargeting } from '../../shared/ads/targeting.js'
import { MIN_VISIBLE_SECONDS } from '../../shared/ads/metrics.js'
import { WEB_ORIGIN } from '../../shared/productLinks.js'

export const AD_BUCKET = 'ad-creatives'
const DAY = 86_400_000

export const hashDeviceToken = (token) => createHash('sha256').update(String(token || '')).digest('hex')
export const newDeviceToken = () => `crt_${randomBytes(24).toString('base64url')}`

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

export function publicUrl(sb, path) {
  if (!path) return null
  const out = sb.storage.from(AD_BUCKET).getPublicUrl(path)
  return out?.data?.publicUrl || null
}

/** A package a partner may pick: approved and active, or a ride bundle / add-on still in draft pricing. */
export const packagePickable = (p) => Boolean(p) && ((p.active && !p.placeholder) || p.kind === 'bundle' || p.kind === 'addon')

/**
 * Packages a partner may pick. Ride bundles show while their prices are a draft (draft: true);
 * billing refuses placeholder rows, so picking a draft bundle never charges anything.
 */
export async function listPackages(sb) {
  const rows = must(await sb.from('ad_packages').select('*').order('sort'), 'packages') || []
  return rows.filter(packagePickable).map((p) => ({ ...p, draft: Boolean(p.placeholder || !p.active) }))
}

export async function createUploadUrl(sb, { filename, contentType }) {
  const path = uploadPathFor(randomUUID(), filename)
  const data = must(await sb.storage.from(AD_BUCKET).createSignedUploadUrl(path), 'upload url')
  return { path, token: data?.token, signedUrl: data?.signedUrl, kind: UPLOAD_TYPES[contentType] }
}

/** Creates partner (pending), campaign (pending_payment) and creative (pending_review). */
export async function signupPartner(sb, body, { user = null, now = new Date() } = {}) {
  const v = normalizeSignup(body)
  let pkg = null
  if (v.packageId !== FOUNDING_PACKAGE) {
    pkg = must(await sb.from('ad_packages').select('*').eq('id', v.packageId).maybeSingle(), 'package')
    if (!packagePickable(pkg) || pkg.kind === 'addon') throw fail(400, 'That package is not available yet.', { errors: { packageId: 'Pick an available package.' } })
  }
  const partner = must(await sb.from('ad_partners').insert({
    profile_id: user?.id || null,
    business_name: v.businessName,
    contact_name: v.contactName,
    email: v.email,
    phone: v.phone,
    category: v.category || null,
    website: v.website || null,
    logo_url: v.logoPath ? publicUrl(sb, v.logoPath) : null,
    status: 'pending',
  }).select('*').single(), 'partner')
  const campaign = must(await sb.from('ad_campaigns').insert({
    partner_id: partner.id,
    package_id: pkg?.id || null,
    name: `${v.businessName}${pkg ? ` · ${pkg.name}` : ' · Founding partner'}`,
    status: 'pending_payment',
    rides_purchased: pkg?.rides_included || null,
    price_cents: pkg ? pkg.price_cents : null,
  }).select('*').single(), 'campaign')
  const creativeRow = v.creativeMode === 'upload'
    ? { kind: UPLOAD_TYPES[v.contentType], storage_path: v.storagePath, media_url: publicUrl(sb, v.storagePath) }
    : { kind: 'built' }
  const creative = must(await sb.from('ad_creatives').insert({
    campaign_id: campaign.id,
    ...creativeRow,
    headline: v.headline || v.businessName,
    deal_text: v.dealText || null,
    qr_url: v.qrUrl || v.website || null,
    logo_url: partner.logo_url,
    theme: v.theme,
    approval_status: 'pending_review',
  }).select('*').single(), 'creative')
  return { partner, campaign, creative, createdAt: now.toISOString() }
}

/** Signed-in partner's own campaigns. Links rows that were created before sign-in by email. */
export async function partnerCampaigns(sb, user) {
  if (user?.email) {
    await sb.from('ad_partners').update({ profile_id: user.id }).is('profile_id', null).eq('email', String(user.email).toLowerCase())
  }
  const partners = must(await sb.from('ad_partners').select('*').eq('profile_id', user.id), 'partners') || []
  if (!partners.length) return { partners: [], campaigns: [] }
  const campaigns = must(await sb.from('ad_campaigns').select('*, ad_creatives(*)').in('partner_id', partners.map((p) => p.id)).order('created_at', { ascending: false }), 'campaigns') || []
  const stats = await impressionStats(sb, campaigns.map((c) => c.id))
  return { partners, campaigns: campaigns.map((c) => ({ ...c, stats: stats[c.id] || { impressions: 0, seconds: 0 } })) }
}

export async function impressionStats(sb, campaignIds = []) {
  if (!campaignIds.length) return {}
  const rows = must(await sb.from('ad_impressions').select('campaign_id, seconds_shown').in('campaign_id', campaignIds).limit(50000), 'impressions') || []
  const out = {}
  for (const r of rows) {
    const s = (out[r.campaign_id] ||= { impressions: 0, seconds: 0 })
    s.impressions += 1
    s.seconds += Number(r.seconds_shown) || 0
  }
  for (const s of Object.values(out)) s.seconds = Math.round(s.seconds)
  return out
}

/* ---------------- Admin ---------------- */

export async function adminOverview(sb) {
  const [partners, campaigns, packages, devices, leads] = await Promise.all([
    sb.from('ad_partners').select('*').order('created_at', { ascending: false }).limit(500),
    sb.from('ad_campaigns').select('*, ad_creatives(*)').order('created_at', { ascending: false }).limit(500),
    sb.from('ad_packages').select('*').order('sort'),
    sb.from('ad_devices').select('id, label, driver_id, vehicle_id, active, demo, last_seen_at, created_at').order('created_at', { ascending: false }),
    sb.from('ad_partner_leads').select('*').order('created_at', { ascending: false }).limit(200),
  ])
  const list = must(campaigns, 'campaigns') || []
  const stats = await impressionStats(sb, list.map((c) => c.id))
  return {
    partners: must(partners, 'partners') || [],
    campaigns: list.map((c) => ({ ...c, stats: stats[c.id] || { impressions: 0, seconds: 0 } })),
    packages: must(packages, 'packages') || [],
    devices: must(devices, 'devices') || [],
    leads: leads.error ? [] : leads.data || [],
  }
}

const CREATIVE_EDITABLE = ['headline', 'deal_text', 'qr_url', 'logo_url', 'theme', 'media_url', 'kind']

export async function adminCreative(sb, b = {}, { now = new Date() } = {}) {
  if (!b.id && !b.campaignId) throw fail(400, 'Creative id or campaignId required')
  const patch = {}
  for (const k of CREATIVE_EDITABLE) if (b[k] !== undefined) patch[k] = b[k] === '' ? null : b[k]
  if (b.decision) {
    if (!['approved', 'rejected', 'pending_review'].includes(b.decision)) throw fail(400, 'Unknown decision')
    patch.approval_status = b.decision
    patch.review_note = b.note ? String(b.note).slice(0, 500) : null
    patch.reviewed_at = now.toISOString()
  }
  patch.updated_at = now.toISOString()
  if (!b.id) {
    return must(await sb.from('ad_creatives').insert({ campaign_id: b.campaignId, kind: patch.kind || 'built', approval_status: 'pending_review', ...patch }).select('*').single(), 'creative')
  }
  return must(await sb.from('ad_creatives').update(patch).eq('id', b.id).select('*').single(), 'creative')
}

/** Campaign transitions an admin may make. Activation fills start/end from the package. */
export async function adminCampaign(sb, b = {}, { now = new Date() } = {}) {
  const c = must(await sb.from('ad_campaigns').select('*, ad_packages(*)').eq('id', b.id).maybeSingle(), 'campaign')
  if (!c) throw fail(404, 'Campaign not found')
  const patch = { updated_at: now.toISOString() }
  for (const k of ['name', 'starts_at', 'ends_at', 'rides_purchased', 'package_id']) if (b[k] !== undefined) patch[k] = b[k] === '' ? null : b[k]
  const action = b.action || ''
  if (action === 'activate') {
    const days = c.ad_packages?.duration_days || 30
    const start = patch.starts_at || c.starts_at || now.toISOString()
    patch.status = 'active'
    patch.starts_at = start
    if (!(patch.ends_at || c.ends_at)) patch.ends_at = new Date(Date.parse(start) + days * DAY).toISOString()
    if (patch.rides_purchased === undefined && c.rides_purchased == null && c.ad_packages?.rides_included) patch.rides_purchased = c.ad_packages.rides_included
  } else if (action === 'pause') patch.status = 'paused'
  else if (action === 'resume') patch.status = 'active'
  else if (action === 'end') { patch.status = 'ended'; patch.ended_reason = 'admin' }
  else if (action === 'pending_payment') patch.status = 'pending_payment'
  else if (action && action !== 'edit') throw fail(400, 'Unknown campaign action')
  delete patch.ad_packages
  return must(await sb.from('ad_campaigns').update(patch).eq('id', c.id).select('*').single(), 'campaign')
}

export async function adminDevice(sb, b = {}) {
  if (b.action === 'revoke') {
    return { device: must(await sb.from('ad_devices').update({ active: false }).eq('id', b.id).select('id, label, active').single(), 'device') }
  }
  const token = newDeviceToken()
  const device = must(await sb.from('ad_devices').insert({
    label: String(b.label || 'Tablet').slice(0, 80),
    token_hash: hashDeviceToken(token),
    driver_id: b.driverId || null,
    vehicle_id: b.vehicleId || null,
    demo: b.demo === true,
  }).select('id, label, driver_id, vehicle_id, demo, active').single(), 'device')
  return { device, token }
}

export async function adminPackage(sb, b = {}, { now = new Date() } = {}) {
  const allowed = ['id', 'name', 'description', 'price_cents', 'slot_seconds', 'frequency', 'placement', 'duration_days', 'rides_included', 'game_day_boost', 'active', 'placeholder', 'sort']
  const row = { updated_at: now.toISOString() }
  for (const k of allowed) if (b[k] !== undefined) row[k] = b[k]
  if (!row.id) throw fail(400, 'Package id required')
  return must(await sb.from('ad_packages').upsert(row).select('*').single(), 'package')
}

/* ---------------- Tablet ---------------- */

export async function deviceFromToken(sb, token, { now = new Date() } = {}) {
  if (!token || String(token).length < 16) return null
  const device = must(await sb.from('ad_devices').select('*').eq('token_hash', hashDeviceToken(token)).maybeSingle(), 'device')
  if (!device || !device.active) return null
  await sb.from('ad_devices').update({ last_seen_at: now.toISOString() }).eq('id', device.id)
  return device
}

/** The paired driver's trip that is in progress right now (rider on board), if any. */
export async function currentTrip(sb, device) {
  if (!device?.driver_id) return null
  const { data } = await sb.from('trips').select('id, status, pickup_lat, pickup_lng, dropoff_lat, dropoff_lng, pickup_at, flight').eq('driver_id', device.driver_id).eq('status', 'in_progress')
    .order('pickup_at', { ascending: false, nullsFirst: false }).limit(1).maybeSingle()
  return data || null
}

/** End campaigns whose date passed or whose rides are used up. */
export async function sweepEndedCampaigns(sb, campaigns, now = new Date()) {
  const ending = campaignsToEnd(campaigns, now)
  for (const { id, reason } of ending) {
    await sb.from('ad_campaigns').update({ status: 'ended', ended_reason: reason, updated_at: now.toISOString() }).eq('id', id).eq('status', 'active')
  }
  return ending
}

/** Where a creative's QR should send riders: campaign deal URL, else the creative's own link. */
export const destinationFor = (campaign, creative) => campaign?.destination_url || creative?.qr_url || creative?.qrUrl || null

/** Short tracking token for one device + creative + ride. Deterministic so a 20 s refresh reuses it. */
export function qrTokenFor(deviceId, creativeId, tripId) {
  return createHash('sha256').update(`ad-qr:${deviceId}:${creativeId}:${tripId || 'idle'}`).digest('base64url').slice(0, 12)
}

export const qrUrlFor = (token, origin = WEB_ORIGIN) => `${origin}/q/${token}`

export async function tabletFeed(sb, device, { now = new Date(), gameDayOverride = null, origin = WEB_ORIGIN } = {}) {
  const rows = must(await sb.from('ad_campaigns').select('*, ad_packages(*), ad_creatives(*), ad_partners(id, lat, lng)').eq('status', 'active'), 'feed') || []
  const ended = new Set((await sweepEndedCampaigns(sb, rows, now)).map((e) => e.id))
  const gameDay = isGameDay(now, gameDayOverride)
  const trip = await currentTrip(sb, device)
  const items = []
  for (const c of rows) {
    if (ended.has(c.id)) continue
    const { ad_packages: pkgRow, ad_creatives: creatives, ad_partners: partner, ...campaign } = c
    if (!tripMatchesTargeting(trip, campaign.targeting, { partner, now, gameDay })) continue
    const base = pkgRow || { placement: 'standard', frequency: 1, slot_seconds: 10, game_day_boost: 1 }
    const pkg = campaign.game_day_boost ? { ...base, game_day_boost: Math.max(2, Number(base.game_day_boost) || 1) } : base
    for (const cr of creatives || []) {
      if (cr.approval_status !== 'approved') continue
      items.push({ id: cr.id, campaign, pkg, creative: cr })
    }
  }
  const loop = buildLoop(items, { now, gameDay }).map((s) => ({
    creativeId: s.creative.id,
    campaignId: s.campaign.id,
    seconds: s.seconds,
    placement: s.pkg.placement || 'standard',
  }))
  const creatives = {}
  const tokens = []
  for (const it of items) {
    const cr = it.creative
    const dest = destinationFor(it.campaign, cr)
    let qrUrl = null
    if (dest) {
      const token = qrTokenFor(device.id, cr.id, trip?.id)
      tokens.push({ token, campaign_id: it.campaign.id, creative_id: cr.id, partner_id: it.campaign.partner_id || null, device_id: device.id, trip_id: trip?.id || null, destination_url: dest })
      qrUrl = qrUrlFor(token, origin)
    }
    creatives[cr.id] = {
      id: cr.id, campaignId: it.campaign.id, kind: cr.kind, mediaUrl: cr.media_url, headline: cr.headline,
      dealText: cr.deal_text, qrUrl, logoUrl: cr.logo_url, theme: cr.theme,
    }
  }
  if (tokens.length) must(await sb.from('ad_qr_tokens').upsert(tokens, { onConflict: 'token', ignoreDuplicates: true }), 'qr tokens')
  return {
    device: { id: device.id, label: device.label, demo: Boolean(device.demo) },
    gameDay,
    trip: trip ? { id: trip.id, status: trip.status } : null,
    loop,
    creatives,
    refreshedAt: now.toISOString(),
  }
}

/**
 * Store a batch of impressions from a tablet. The ride counter uses the server's view of the
 * driver's in-progress trip, never a trip id from the device.
 */
export async function recordImpressions(sb, device, batch = [], { now = new Date() } = {}) {
  const list = (Array.isArray(batch) ? batch : []).slice(0, 200)
  if (!list.length) return { stored: 0, ridesCounted: 0 }
  const trip = await currentTrip(sb, device)
  const campaignIds = [...new Set(list.map((i) => i.campaignId).filter(Boolean))]
  const live = must(await sb.from('ad_campaigns').select('id, status, partner_id').in('id', campaignIds), 'campaigns') || []
  const known = new Set(live.map((c) => c.id))
  const partnerOf = new Map(live.map((c) => [c.id, c.partner_id || null]))
  const rows = list
    .filter((i) => known.has(i.campaignId))
    .map((i) => {
      const shown = Date.parse(i.shownAt)
      const tripId = i.inTrip && trip ? trip.id : null
      const seconds = Math.max(0, Math.min(600, Number(i.seconds) || 0))
      return {
        campaign_id: i.campaignId,
        creative_id: i.creativeId || null,
        device_id: device.id,
        driver_id: device.driver_id || null,
        vehicle_id: device.vehicle_id || null,
        partner_id: partnerOf.get(i.campaignId),
        trip_id: tripId,
        visible: i.visible === true && seconds >= MIN_VISIBLE_SECONDS,
        qr_token: i.creativeId ? qrTokenFor(device.id, i.creativeId, tripId) : null,
        shown_at: Number.isFinite(shown) && shown <= now.getTime() + 60_000 ? new Date(shown).toISOString() : now.toISOString(),
        seconds_shown: seconds,
        client_id: String(i.clientId || '').slice(0, 64) || null,
      }
    })
  if (rows.length) must(await sb.from('ad_impressions').upsert(rows, { onConflict: 'device_id,client_id', ignoreDuplicates: true }), 'impressions')
  let ridesCounted = 0
  if (trip && !device.demo) {
    const active = new Set(live.filter((c) => c.status === 'active').map((c) => c.id))
    for (const id of new Set(rows.filter((r) => r.trip_id && active.has(r.campaign_id)).map((r) => r.campaign_id))) {
      const { data } = await sb.rpc('ad_count_ride', { p_campaign: id, p_trip: trip.id, p_device: device.id })
      const row = Array.isArray(data) ? data[0] : data
      if (row?.counted) ridesCounted += 1
    }
  }
  return { stored: rows.length, ridesCounted, trip: trip ? trip.id : null }
}
