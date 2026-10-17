import assert from 'node:assert/strict'
import test from 'node:test'
import http from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fakeAdsDb } from './helpers/fakeAdsDb.js'
import { createAdsHandler } from '../api/ads.js'
import { hashDeviceToken, listPackages, qrTokenFor, recordImpressions, tabletFeed } from '../server/ads/service.js'
import {
  adminApplication, adminBoost, partnerBoost, partnerDashboard, partnerLaunchCampaign, partnerSaveCampaign, recordQrScan, visitorHash,
} from '../server/ads/tracking.js'
import { handleAdsStripeEvent, isAdsStripeEvent, startBoostPayment } from '../server/ads/billing.js'
import {
  METRIC_DEFINITIONS, MIN_VISIBLE_SECONDS, boostQuote, campaignChip, campaignMetrics, creativeRanking, isShownImpression, rideRef, ridesCsv, sumMetrics,
} from '../shared/ads/metrics.js'
import { describeTargeting, normalizeTargeting, tripMatchesTargeting, tripRouteTypes } from '../shared/ads/targeting.js'
import { applicationErrors } from '../shared/ads/application.js'
import { createApp, isShortLinkPath } from '../server/selfHost.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NOW = new Date('2026-10-14T16:00:00Z') // Wednesday noon ET
const DAY = 86_400_000
const PARTNER_USER = { id: 'u-partner', email: 'pat@example.test' }
const STRANGER = { id: 'u-stranger', email: 'x@example.test' }
const OWNER = { id: 'owner-1', email: 'johnmatveyev@gmail.com' }
const TOKEN = 'crt_test_token_123456'

// Clemson-area points for targeting tests
const CAMPUS_A = { lat: 34.6780, lng: -82.8370 }
const CAMPUS_B = { lat: 34.6850, lng: -82.8300 }
const GSP = { lat: 34.8957, lng: -82.2189 }
const trip = (over = {}) => ({ id: 'trip-1', status: 'in_progress', driver_id: 'drv1', pickup_lat: CAMPUS_A.lat, pickup_lng: CAMPUS_A.lng, dropoff_lat: CAMPUS_B.lat, dropoff_lng: CAMPUS_B.lng, pickup_at: NOW.toISOString(), flight: null, ...over })

const bundle = (over = {}) => ({ id: 'rides-100', kind: 'bundle', name: '100 rides', price_cents: 1200, rides_included: 100, slot_seconds: 10, frequency: 1, placement: 'standard', duration_days: 120, game_day_boost: 1, active: false, placeholder: true, ...over })
const campaign = (over = {}) => ({ id: 'c1', partner_id: 'p1', package_id: 'rides-100', name: 'TEST Biz · 100 rides', status: 'active', starts_at: new Date(NOW - DAY).toISOString(), ends_at: new Date(+NOW + 30 * DAY).toISOString(), rides_purchased: 100, rides_served: 0, price_cents: 1200, targeting: { radius_mi: 0, routes: ['all'] }, destination_url: 'https://tigertavern.example/deal', game_day_boost: false, ...over })
const creative = (over = {}) => ({ id: 'cr1', campaign_id: 'c1', kind: 'built', headline: 'TEST Tiger Tavern', deal_text: 'Deal', qr_url: null, approval_status: 'approved', ...over })

function seed() {
  return {
    ad_packages: [bundle(), bundle({ id: 'rides-1000', name: '1,000 rides', price_cents: 8900, rides_included: 1000 }), bundle({ id: 'game-day-weekend', kind: 'addon', rides_included: null, price_cents: 0 }), { id: 'placeholder-local', kind: 'package', active: false, placeholder: true, price_cents: 0 }],
    ad_partners: [
      { id: 'p1', profile_id: PARTNER_USER.id, business_name: 'TEST Tiger Tavern', contact_name: 'Pat', email: PARTNER_USER.email, status: 'active', auto_approve_creatives: false, lat: null, lng: null },
      { id: 'p2', profile_id: 'u-other', business_name: 'TEST Other', contact_name: 'Sam', email: 'sam@example.test', status: 'active' },
    ],
    ad_campaigns: [campaign()],
    ad_creatives: [creative()],
    ad_devices: [{ id: 'd1', label: 'Car 1', token_hash: hashDeviceToken(TOKEN), driver_id: 'drv1', active: true, demo: false }],
    trips: [],
  }
}

function res() {
  return { statusCode: 0, body: '', headers: {}, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b == null ? '' : String(b) }, get json() { return this.body ? JSON.parse(this.body) : null } }
}
async function call(handler, { method = 'GET', action, body, headers = {}, query = '' }) {
  const r = res()
  await handler({ method, url: `/api/ads?action=${action}${query}`, headers, body }, r)
  return r
}

/* ---------- counters ---------- */

test('counters keep ad runs, impressions shown, distinct rides and unique QR scans separate', () => {
  const impressions = [
    { creative_id: 'a', trip_id: 't1', visible: true, seconds_shown: 10 }, // shown
    { creative_id: 'a', trip_id: 't1', visible: true, seconds_shown: 10 }, // shown, same ride
    { creative_id: 'a', trip_id: 't2', visible: false, seconds_shown: 10 }, // screen off: run only
    { creative_id: 'a', trip_id: 't2', visible: true, seconds_shown: MIN_VISIBLE_SECONDS - 0.5 }, // too short: run only
    { creative_id: 'a', trip_id: null, visible: true, seconds_shown: 10 }, // no ride: run only
  ]
  const rideCounts = [{ trip_id: 't1', counted_at: '2026-10-14T16:00:00Z' }, { trip_id: 't2', counted_at: '2026-10-14T17:00:00Z' }, { trip_id: 't2', counted_at: '2026-10-14T17:00:00Z' }]
  const scans = [{ trip_id: 't1', duplicate: false }, { trip_id: 't1', duplicate: true }, { trip_id: 't1', duplicate: false }]
  const m = campaignMetrics({ campaign: { rides_purchased: 100, rides_served: 2 }, impressions, rideCounts, scans })
  assert.equal(m.runs, 5)
  assert.equal(m.impressions, 2)
  assert.equal(m.rides, 2)
  assert.equal(m.scans, 2, 'duplicate scans do not count')
  assert.equal(m.scansTotal, 3)
  assert.equal(m.scanRate, 100)
  assert.equal(m.ridesRemaining, 98)
  assert.deepEqual(m.rideList.map((r) => [r.ref, r.scans]), [[rideRef('t2'), 0], [rideRef('t1'), 2]])
  assert.equal(isShownImpression({ trip_id: 't', visible: true, seconds_shown: 3 }), true)
  assert.deepEqual(sumMetrics([m, m]), { runs: 10, impressions: 4, rides: 4, scans: 4, scanRate: 100 })
  const csv = ridesCsv('TEST, "Biz"', m.rideList)
  assert.equal(csv.split('\n')[0], 'campaign,ride,time_et,qr_scans')
  assert.match(csv, /"TEST, ""Biz""",R-/)
  assert.match(csv, /"10\/14\/2026, 12:00 ET",2/)
  for (const k of ['runs', 'impressions', 'rides', 'scans']) assert.ok(METRIC_DEFINITIONS[k].length > 20)
})

test('creative ranking orders ads by QR scans per ride', () => {
  const r = creativeRanking({
    creatives: [{ id: 'a', headline: 'A' }, { id: 'b', headline: 'B' }, { id: 'c', headline: 'C' }],
    impressions: [{ creative_id: 'a', trip_id: 't1' }, { creative_id: 'a', trip_id: 't2' }, { creative_id: 'b', trip_id: 't1' }, { creative_id: 'a', trip_id: null }],
    scans: [{ creative_id: 'a', duplicate: false }, { creative_id: 'b', duplicate: false }, { creative_id: 'b', duplicate: true }],
  })
  assert.deepEqual(r.map((x) => [x.creativeId, x.rides, x.scans, x.scanRate]), [['b', 1, 1, 100], ['a', 2, 1, 50], ['c', 0, 0, 0]])
})

test('status chips: draft, pending review, pending payment, live, paused, completed', () => {
  assert.equal(campaignChip({ status: 'draft' }).label, 'Draft')
  assert.equal(campaignChip({ status: 'pending_payment', ad_creatives: [{ approval_status: 'pending_review' }] }).label, 'Pending review')
  assert.equal(campaignChip({ status: 'pending_payment', ad_creatives: [{ approval_status: 'approved' }] }).label, 'Pending payment')
  assert.equal(campaignChip({ status: 'active', ad_creatives: [{ approval_status: 'approved' }] }).label, 'Live')
  assert.equal(campaignChip({ status: 'paused' }).label, 'Paused')
  assert.equal(campaignChip({ status: 'ended' }).label, 'Completed')
})

/* ---------- targeting ---------- */

test('targeting: route types and radius decide eligibility for the in-progress ride', () => {
  assert.deepEqual(normalizeTargeting({ routes: ['airport', 'bogus'], radius_mi: 4 }), { radius_mi: 0, routes: ['airport'] })
  assert.deepEqual(normalizeTargeting({}), { radius_mi: 0, routes: ['all'] })
  const campus = trip()
  assert.ok(tripRouteTypes(campus).has('campus'))
  assert.ok(!tripRouteTypes(campus).has('airport'))
  assert.ok(tripRouteTypes(trip({ dropoff_lat: GSP.lat, dropoff_lng: GSP.lng })).has('airport'))
  assert.ok(tripRouteTypes(trip({ pickup_at: '2026-10-15T03:30:00Z' })).has('late_night'), '11:30 PM ET')
  assert.ok(!tripRouteTypes(trip({ pickup_at: '2026-10-15T08:30:00Z' })).has('late_night'), '4:30 AM ET')
  assert.ok(tripRouteTypes(trip({ dropoff_lat: 34.6788, dropoff_lng: -82.8432 }), { gameDay: true }).has('stadium'))
  assert.ok(!tripRouteTypes(trip({ dropoff_lat: 34.6788, dropoff_lng: -82.8432 }), { gameDay: false }).has('stadium'))
  assert.equal(tripMatchesTargeting(campus, { routes: ['airport'] }), false)
  assert.equal(tripMatchesTargeting(campus, { routes: ['campus', 'airport'] }), true)
  assert.equal(tripMatchesTargeting(null, { routes: ['airport'] }), true, 'idle loop plays everything (never counted)')
  const near = { lat: 34.6835, lng: -82.8375 }
  const far = { lat: 34.85, lng: -82.39 } // Greenville
  assert.equal(tripMatchesTargeting(campus, { radius_mi: 1 }, { partner: near }), true)
  assert.equal(tripMatchesTargeting(campus, { radius_mi: 5 }, { partner: far }), false)
  assert.equal(tripMatchesTargeting(campus, { radius_mi: 5 }, { partner: { lat: null, lng: null } }), true, 'no map pin: radius not enforced')
  assert.match(describeTargeting({ routes: ['late_night'], radius_mi: 3 }), /Late night.*within 3 mi/)
})

/* ---------- tablet feed, impressions, QR ---------- */

test('tablet feed swaps deal links for /q/ tracking codes and filters by targeting during a ride', async () => {
  const s = seed()
  s.ad_campaigns.push(campaign({ id: 'c2', partner_id: 'p2', targeting: { routes: ['airport'] }, destination_url: 'https://other.example' }))
  s.ad_creatives.push(creative({ id: 'cr2', campaign_id: 'c2', headline: 'TEST Airport only' }))
  const db = fakeAdsDb(s)
  const device = db.tables.ad_devices[0]
  const idle = await tabletFeed(db, device, { now: NOW, origin: 'https://clemsonrides.com' })
  assert.deepEqual(Object.keys(idle.creatives).sort(), ['cr1', 'cr2'])
  assert.equal(idle.creatives.cr1.qrUrl, `https://clemsonrides.com/q/${qrTokenFor('d1', 'cr1', null)}`)
  assert.doesNotMatch(JSON.stringify(idle), /tigertavern\.example/, 'the destination never reaches the tablet')
  db.tables.trips.push(trip())
  const riding = await tabletFeed(db, device, { now: NOW, origin: 'https://clemsonrides.com' })
  assert.deepEqual(Object.keys(riding.creatives), ['cr1'], 'airport-only ad skipped on a campus ride')
  const tok = db.tables.ad_qr_tokens.find((t) => t.trip_id === 'trip-1')
  assert.deepEqual([tok.campaign_id, tok.creative_id, tok.partner_id, tok.device_id, tok.destination_url], ['c1', 'cr1', 'p1', 'd1', 'https://tigertavern.example/deal'])
  await tabletFeed(db, device, { now: NOW })
  assert.equal(db.tables.ad_qr_tokens.filter((t) => t.trip_id === 'trip-1').length, 1, 'refresh reuses the token')
})

test('each play logs ride, time, campaign, creative, device, partner and visibility; rides count once', async () => {
  const db = fakeAdsDb({ ...seed(), trips: [trip()] })
  const device = db.tables.ad_devices[0]
  const shownAt = new Date(+NOW - 20_000).toISOString()
  const out = await recordImpressions(db, device, [
    { clientId: 'a', campaignId: 'c1', creativeId: 'cr1', shownAt, seconds: 10, inTrip: true, visible: true },
    { clientId: 'b', campaignId: 'c1', creativeId: 'cr1', shownAt, seconds: 10, inTrip: true, visible: false },
    { clientId: 'c', campaignId: 'c1', creativeId: 'cr1', shownAt, seconds: 2, inTrip: true, visible: true },
  ], { now: NOW })
  assert.deepEqual([out.stored, out.ridesCounted, out.trip], [3, 1, 'trip-1'])
  const [a, b, c] = db.tables.ad_impressions
  assert.deepEqual([a.trip_id, a.campaign_id, a.creative_id, a.device_id, a.partner_id, a.shown_at, a.visible], ['trip-1', 'c1', 'cr1', 'd1', 'p1', shownAt, true])
  assert.equal(a.qr_token, qrTokenFor('d1', 'cr1', 'trip-1'))
  assert.equal(b.visible, false)
  assert.equal(c.visible, false, 'under the minimum on-screen time')
  await recordImpressions(db, device, [{ clientId: 'd', campaignId: 'c1', creativeId: 'cr1', shownAt, seconds: 10, inTrip: true, visible: true }], { now: NOW })
  assert.equal(db.tables.ad_campaigns[0].rides_served, 1, 'one ride per campaign per trip')
  assert.equal(db.tables.ad_ride_counts.length, 1)
})

test('QR scan: logs the scan with its ride and redirects; dedupes repeats; skips bots; unknown goes to /advertise', async () => {
  const db = fakeAdsDb({ ...seed(), ad_qr_tokens: [{ token: 'tok_abc12345', campaign_id: 'c1', creative_id: 'cr1', partner_id: 'p1', device_id: 'd1', trip_id: 'trip-1', destination_url: 'https://tigertavern.example/deal' }] })
  const phone = { userAgent: 'Mozilla/5.0 (iPhone)', ip: '203.0.113.9' }
  const first = await recordQrScan(db, 'tok_abc12345', { ...phone, now: NOW })
  assert.deepEqual(first, { location: 'https://tigertavern.example/deal', logged: true, duplicate: false })
  const row = db.tables.ad_qr_scans[0]
  assert.deepEqual([row.token, row.campaign_id, row.creative_id, row.partner_id, row.device_id, row.trip_id, row.user_agent], ['tok_abc12345', 'c1', 'cr1', 'p1', 'd1', 'trip-1', 'Mozilla/5.0 (iPhone)'])
  assert.equal(row.scanned_at, NOW.toISOString())
  assert.ok(!JSON.stringify(row).includes('203.0.113.9'), 'no raw IP stored')
  assert.equal(row.visitor_hash, visitorHash({ ...phone, now: NOW }))
  assert.equal((await recordQrScan(db, 'tok_abc12345', { ...phone, now: new Date(+NOW + 5 * 60_000) })).duplicate, true)
  assert.equal((await recordQrScan(db, 'tok_abc12345', { ...phone, now: new Date(+NOW + 45 * 60_000) })).duplicate, false, 'outside the 30 minute window')
  assert.equal((await recordQrScan(db, 'tok_abc12345', { userAgent: 'Slackbot-LinkExpanding 1.0', now: NOW })).logged, false)
  assert.equal((await recordQrScan(db, 'tok_abc12345', { ...phone, now: NOW, allowLog: false })).logged, false)
  assert.equal(db.tables.ad_qr_scans.length, 3)
  assert.deepEqual(await recordQrScan(db, 'nope_nope_nope', { now: NOW }), { location: 'https://clemsonrides.com/advertise', logged: false, reason: 'unknown_token' })
  assert.equal((await recordQrScan(db, '../etc', { now: NOW })).reason, 'bad_token')
  db.tables.ad_qr_tokens.push({ token: 'tok_js123456', campaign_id: 'c1', destination_url: 'javascript:alert(1)' })
  assert.equal((await recordQrScan(db, 'tok_js123456', { ...phone, now: NOW })).location, 'https://clemsonrides.com/advertise', 'only http(s) destinations')
})

test('/api/ads?action=qr answers 302 with no-store, and /q/<token> reaches it on the self-hosted server', async () => {
  const db = fakeAdsDb({ ...seed(), ad_qr_tokens: [{ token: 'tok_abc12345', campaign_id: 'c1', destination_url: 'https://tigertavern.example/deal' }] })
  const handler = createAdsHandler({ db: () => db, limit: () => true, now: () => NOW })
  const r = await call(handler, { action: 'qr', query: '&token=tok_abc12345', headers: { 'user-agent': 'Mozilla/5.0 (iPhone)', 'x-forwarded-for': '198.51.100.7' } })
  assert.equal(r.statusCode, 302)
  assert.equal(r.headers.Location, 'https://tigertavern.example/deal')
  assert.equal(r.headers['Cache-Control'], 'no-store')
  assert.equal(db.tables.ad_qr_scans.length, 1)

  assert.equal(isShortLinkPath('/q/tok_abc12345'), true)
  assert.equal(isShortLinkPath('/q/../x'), false)
  const apiDir = await mkdtemp(path.join(tmpdir(), 'ads-q-'))
  await writeFile(path.join(apiDir, 'ads.js'), 'export default (req, res) => { res.statusCode = 302; res.setHeader("Location", "https://dest.example/" + req.query.action + "/" + req.query.token); res.end() }\n')
  const distDir = await mkdtemp(path.join(tmpdir(), 'ads-q-dist-'))
  await writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>spa</title>')
  const app = await createApp({ distDir, apiDir, vercelPath: path.join(ROOT, 'vercel.json'), log() {} })
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const { port } = server.address()
    const hit = await fetch(`http://127.0.0.1:${port}/q/tok_abc12345`, { redirect: 'manual' })
    assert.equal(hit.status, 302)
    assert.equal(hit.headers.get('location'), 'https://dest.example/qr/tok_abc12345')
    const page = await fetch(`http://127.0.0.1:${port}/advertise`)
    assert.match(await page.text(), /spa/, 'other page paths still serve the SPA')
  } finally {
    await new Promise((resolve) => server.close(resolve))
    await rm(apiDir, { recursive: true, force: true })
    await rm(distDir, { recursive: true, force: true })
  }
})

/* ---------- self-serve ---------- */

test('only onboarded partners build, create and launch; drafts stay drafts; launch goes to review and pending payment', async () => {
  const s = seed()
  s.ad_partners[0].status = 'pending'
  const db = fakeAdsDb(s)
  const body = { packageId: 'rides-1000', creativeMode: 'build', headline: 'TEST Tiger Tavern', dealText: '$5 pitchers before kickoff', theme: 'orange', destinationUrl: 'https://tigertavern.example/gameday', targeting: { radius_mi: 3, routes: ['stadium', 'late_night'] }, gameDayBoost: true }
  await assert.rejects(partnerSaveCampaign(db, PARTNER_USER, body, { now: NOW }), /not active yet/)
  db.tables.ad_partners[0].status = 'active'
  await assert.rejects(partnerSaveCampaign(db, PARTNER_USER, { ...body, packageId: 'game-day-weekend' }, { now: NOW }), /ride bundle/)
  await assert.rejects(partnerSaveCampaign(db, PARTNER_USER, { ...body, destinationUrl: 'ftp://x' }, { now: NOW }), (e) => Boolean(e.errors?.destinationUrl))
  const draft = await partnerSaveCampaign(db, PARTNER_USER, body, { now: NOW })
  assert.equal(draft.campaign.status, 'draft')
  assert.deepEqual(draft.campaign.targeting, { radius_mi: 3, routes: ['stadium', 'late_night'] })
  assert.deepEqual([draft.campaign.rides_purchased, draft.campaign.price_cents, draft.campaign.game_day_boost], [1000, 8900, true])
  assert.equal(draft.creative.approval_status, 'pending_review')
  assert.equal(draft.creative.qr_url, 'https://tigertavern.example/gameday')
  await assert.rejects(partnerLaunchCampaign(db, STRANGER, { id: draft.campaign.id }, { now: NOW }), /not found/)
  const launched = await partnerLaunchCampaign(db, PARTNER_USER, { id: draft.campaign.id }, { now: NOW })
  assert.equal(launched.campaign.status, 'pending_payment')
  assert.equal(db.tables.ad_creatives.find((c) => c.campaign_id === draft.campaign.id).approval_status, 'pending_review', 'John still reviews it')
  await assert.rejects(partnerSaveCampaign(db, PARTNER_USER, { ...body, id: draft.campaign.id }, { now: NOW }), /Only draft/)
})

test('auto-approve toggle (default off) skips review on launch for that partner only', async () => {
  const db = fakeAdsDb(seed())
  db.tables.ad_partners[0].auto_approve_creatives = true
  const out = await partnerSaveCampaign(db, PARTNER_USER, { packageId: 'rides-100', creativeMode: 'build', headline: 'TEST', dealText: 'Deal here', launch: true }, { now: NOW })
  assert.equal(out.autoApproved, true)
  assert.equal(out.creative.approval_status, 'approved')
  assert.equal(out.campaign.status, 'pending_payment', 'still needs payment (billing off)')
  const handler = createAdsHandler({ db: () => db, auth: async () => OWNER, now: () => NOW })
  const r = await call(handler, { method: 'POST', action: 'admin-partner', body: { id: 'p1', auto_approve_creatives: false } })
  assert.equal(r.statusCode, 200)
  assert.equal(db.tables.ad_partners[0].auto_approve_creatives, false)
  const denied = createAdsHandler({ db: () => db, auth: async () => PARTNER_USER })
  assert.equal((await call(denied, { method: 'POST', action: 'admin-partner', body: { id: 'p1', auto_approve_creatives: true } })).statusCode, 403)
})

test('partner dashboard shows only own campaigns with live counters; not onboarded partners get the onboarding prompt flag', async () => {
  const s = seed()
  s.ad_campaigns.push(campaign({ id: 'c-other', partner_id: 'p2' }))
  s.ad_impressions = [{ campaign_id: 'c1', creative_id: 'cr1', trip_id: 't1', visible: true, seconds_shown: 10 }, { campaign_id: 'c-other', creative_id: 'x', trip_id: 't1', visible: true, seconds_shown: 10 }]
  s.ad_ride_counts = [{ campaign_id: 'c1', trip_id: 't1', counted_at: NOW.toISOString() }]
  s.ad_qr_scans = [{ campaign_id: 'c1', creative_id: 'cr1', trip_id: 't1', duplicate: false }]
  const db = fakeAdsDb(s)
  const d = await partnerDashboard(db, PARTNER_USER)
  assert.equal(d.onboarded, true)
  assert.deepEqual(d.campaigns.map((c) => c.id), ['c1'])
  assert.deepEqual([d.campaigns[0].metrics.runs, d.campaigns[0].metrics.impressions, d.campaigns[0].metrics.rides, d.campaigns[0].metrics.scans], [1, 1, 1, 1])
  assert.equal(d.campaigns[0].creativeRanking[0].scanRate, 100)
  assert.equal(d.partners[0].stripe_customer_id, undefined)
  db.tables.ad_partners[0].status = 'pending'
  assert.equal((await partnerDashboard(db, PARTNER_USER)).onboarded, false)
  assert.deepEqual((await partnerDashboard(db, STRANGER)).campaigns, [])
})

/* ---------- boost ---------- */

test('boost doubles the remaining rides at the per-ride rate; billing off leaves it pending_payment', async () => {
  assert.deepEqual(boostQuote({ status: 'active', rides_purchased: 100, rides_served: 40, price_cents: 1200 }), { ok: true, ridesAdded: 60, perRideCents: 12, priceCents: 720 })
  assert.equal(boostQuote({ status: 'active', rides_purchased: 100, rides_served: 100, price_cents: 1200 }).ok, false)
  assert.equal(boostQuote({ status: 'draft', rides_purchased: 100, rides_served: 0, price_cents: 1200 }).ok, false)
  const db = fakeAdsDb(seed())
  db.tables.ad_campaigns[0].rides_served = 40
  const handler = createAdsHandler({ db: () => db, auth: async () => PARTNER_USER, now: () => NOW, env: {}, stripe: () => { throw new Error('stripe must not be touched') } })
  const quote = await call(handler, { method: 'POST', action: 'partner-boost', body: { campaignId: 'c1' } })
  assert.deepEqual(quote.json.quote, { ok: true, ridesAdded: 60, perRideCents: 12, priceCents: 720 })
  assert.equal(db.tables.ad_campaign_boosts.length, 0, 'quote only, nothing stored before confirm')
  const r = await call(handler, { method: 'POST', action: 'partner-boost', body: { campaignId: 'c1', confirm: true } })
  assert.equal(r.statusCode, 200, r.body)
  assert.equal(r.json.boost.status, 'pending_payment')
  assert.equal(r.json.billing.skipped, true)
  assert.equal((await call(handler, { method: 'POST', action: 'partner-boost', body: { campaignId: 'c1', confirm: true } })).statusCode, 409)
  const stranger = createAdsHandler({ db: () => db, auth: async () => STRANGER })
  assert.equal((await call(stranger, { method: 'POST', action: 'partner-boost', body: { campaignId: 'c1' } })).statusCode, 404)
  const applied = await adminBoost(db, { id: r.json.boost.id, action: 'apply' }, { now: NOW })
  assert.equal(applied.campaign.rides_purchased, 160)
  assert.equal(applied.campaign.price_cents, 1920)
  assert.equal((await adminBoost(db, { id: r.json.boost.id, action: 'apply' })).already, true)
})

test('boost invoice (mocked Stripe, flag on) and the ad_boost webhook apply the rides', async () => {
  const db = fakeAdsDb({ ...seed(), ad_packages: [bundle({ placeholder: false, active: true })] })
  db.tables.ad_campaigns[0].rides_served = 50
  const { boost } = await partnerBoost(db, PARTNER_USER, { campaignId: 'c1', confirm: true }, { now: NOW })
  const calls = []
  const stripe = {
    customers: { create: async (p) => { calls.push(['customers.create', p]); return { id: 'cus_t' } } },
    invoices: {
      create: async (p) => { calls.push(['invoices.create', p]); return { id: 'in_t' } },
      finalizeInvoice: async (id) => ({ id, hosted_invoice_url: 'https://invoice.stripe.test/b' }),
    },
    invoiceItems: { create: async (p) => { calls.push(['invoiceItems.create', p]); return {} } },
  }
  assert.equal((await startBoostPayment({ stripe, sb: db, boostId: boost.id, env: {} })).skipped, true)
  const out = await startBoostPayment({ stripe, sb: db, boostId: boost.id, env: { ADS_BILLING_ENABLED: 'true' } })
  assert.equal(out.payment_url, 'https://invoice.stripe.test/b')
  assert.equal(calls.find((c) => c[0] === 'invoiceItems.create')[1].amount, 600)
  const ev = { type: 'invoice.paid', data: { object: { object: 'invoice', id: 'in_t', metadata: { kind: 'ad_boost', boost_id: boost.id, campaign_id: 'c1' } } } }
  assert.equal(isAdsStripeEvent(ev), true)
  const paid = await handleAdsStripeEvent(db, ev, { now: NOW })
  assert.equal(paid.boostApplied, boost.id)
  assert.equal(db.tables.ad_campaigns[0].rides_purchased, 150)
  const draftDb = fakeAdsDb(seed())
  const b2 = await partnerBoost(draftDb, PARTNER_USER, { campaignId: 'c1', confirm: true }, { now: NOW })
  await assert.rejects(startBoostPayment({ stripe, sb: draftDb, boostId: b2.boost.id, env: { ADS_BILLING_ENABLED: 'true' } }), /Placeholder/, 'draft bundles are never billed')
})

/* ---------- founding-partner applications ---------- */

test('founding-partner application: validation, honeypot, pending insert, owner approval unlocks founding rates', async () => {
  const good = { businessName: 'TEST Tiger Tavern', category: 'Restaurant or bar', address: '1 College Ave, Clemson, SC', contactName: 'Pat', email: 'NEW@example.test', promote: 'Game-day specials', offer: '$5 pitchers' }
  assert.deepEqual(Object.keys(applicationErrors({})).sort(), ['address', 'businessName', 'category', 'contactName', 'email', 'promote'])
  assert.deepEqual(applicationErrors(good), {})
  const db = fakeAdsDb(seed())
  const sent = []
  const handler = createAdsHandler({ db: () => db, auth: async () => null, limit: () => true, recipients: () => ['owner@example.test'], send: async (m) => sent.push(m) })
  assert.equal((await call(handler, { method: 'POST', action: 'apply', body: { ...good, company_url: 'spam' } })).statusCode, 200)
  assert.equal(db.tables.ad_partner_applications.length, 0, 'honeypot stores nothing')
  assert.equal((await call(handler, { method: 'POST', action: 'apply', body: { ...good, email: 'bad' } })).statusCode, 400)
  const ok = await call(handler, { method: 'POST', action: 'apply', body: good })
  assert.deepEqual(ok.json, { ok: true, status: 'pending' })
  const app = db.tables.ad_partner_applications[0]
  assert.deepEqual([app.business_name, app.email, app.status], ['TEST Tiger Tavern', 'new@example.test', 'pending'])
  assert.equal(sent.length, 1, 'internal admin notice only')
  const limited = createAdsHandler({ db: () => db, auth: async () => null, limit: () => false })
  assert.equal((await call(limited, { method: 'POST', action: 'apply', body: good })).statusCode, 429)
  const approved = await adminApplication(db, { id: app.id, decision: 'approved' }, { now: NOW })
  assert.deepEqual([approved.partner.founding_approved, approved.partner.status, approved.application.status], [true, 'active', 'approved'])
  assert.equal(approved.application.partner_id, approved.partner.id)
  await assert.rejects(adminApplication(db, { id: app.id, decision: 'maybe' }), /Decision/)
  const notOwner = createAdsHandler({ db: () => db, auth: async () => PARTNER_USER })
  assert.equal((await call(notOwner, { method: 'POST', action: 'admin-application', body: { id: app.id, decision: 'declined' } })).statusCode, 403)
})

/* ---------- bundles in sign-up ---------- */

test('draft ride bundles are pickable in sign-up but placeholder packages and add-ons are not', async () => {
  const db = fakeAdsDb(seed())
  const list = await listPackages(db)
  assert.deepEqual(list.map((p) => [p.id, p.draft]), [['rides-100', true], ['rides-1000', true], ['game-day-weekend', true]])
  const handler = createAdsHandler({ db: () => db, auth: async () => null, limit: () => true, recipients: () => [] })
  const base = { businessName: 'TEST Tacos', contactName: 'Pat', email: 'p@example.test', phone: '8645550100', creativeMode: 'build', headline: 'TEST', dealText: 'Deal' }
  const ok = await call(handler, { method: 'POST', action: 'signup', body: { ...base, packageId: 'rides-1000' } })
  assert.equal(ok.statusCode, 200)
  assert.deepEqual([db.tables.ad_campaigns.at(-1).rides_purchased, db.tables.ad_campaigns.at(-1).price_cents], [1000, 8900])
  assert.equal((await call(handler, { method: 'POST', action: 'signup', body: { ...base, packageId: 'placeholder-local' } })).statusCode, 400)
  assert.equal((await call(handler, { method: 'POST', action: 'signup', body: { ...base, packageId: 'game-day-weekend' } })).statusCode, 400)
})
