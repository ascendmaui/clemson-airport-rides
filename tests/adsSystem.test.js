import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeAdsDb } from './helpers/fakeAdsDb.js'
import { adWeight, buildLoop, campaignBlockReason, campaignsToEnd } from '../shared/ads/rotation.js'
import { signupErrors, uploadErrors, uploadPathFor } from '../shared/ads/signup.js'
import { createAdsHandler, isAdsOwner } from '../api/ads.js'
import { hashDeviceToken, recordImpressions, tabletFeed } from '../server/ads/service.js'
import { adsBillingEnabled, campaignAmountCents, handleAdsStripeEvent, isAdsStripeEvent, startCampaignPayment } from '../server/ads/billing.js'
import { planAdsAutomation, runAdsAutomation } from '../server/ads/automation.js'
import { applyPackageSync, planPackageSync } from '../scripts/ads/sync-stripe-packages.mjs'
import stripeWebhook from '../api/stripe-webhook.js'

const NOW = new Date('2026-10-14T16:00:00Z') // a Wednesday
const SATURDAY = new Date('2026-10-17T18:00:00Z') // 2pm ET Saturday in October
const DAY = 86_400_000
const OWNER = { id: 'owner-1', email: 'johnmatveyev@gmail.com' }
const OTHER_ADMIN = { id: 'other', email: 'lead@clemson.edu' }

const pkg = (over = {}) => ({ id: 'local', name: 'Local', price_cents: 20000, slot_seconds: 10, frequency: 1, placement: 'standard', duration_days: 30, rides_included: 3, game_day_boost: 1, active: true, placeholder: false, ...over })
const campaign = (over = {}) => ({ id: 'c1', partner_id: 'p1', package_id: 'local', status: 'active', starts_at: new Date(NOW - DAY).toISOString(), ends_at: new Date(+NOW + 10 * DAY).toISOString(), rides_purchased: 3, rides_served: 0, ...over })
const creative = (over = {}) => ({ id: 'cr1', campaign_id: 'c1', kind: 'built', headline: 'TEST Biz', deal_text: 'Deal', approval_status: 'approved', ...over })

function seed() {
  return {
    ad_packages: [pkg(), pkg({ id: 'featured', placement: 'first_in_loop', frequency: 2, slot_seconds: 15 }), pkg({ id: 'gameday', placement: 'takeover', game_day_boost: 3, rides_included: null }), pkg({ id: 'ph', placeholder: true, active: false })],
    ad_partners: [{ id: 'p1', business_name: 'TEST Biz', contact_name: 'Pat', email: 'pat@example.test', phone: '8645550100', status: 'active' }],
    ad_campaigns: [campaign()],
    ad_creatives: [creative()],
    ad_devices: [{ id: 'd1', label: 'Car 1', token_hash: hashDeviceToken('crt_test_token_123456'), driver_id: 'drv1', active: true, demo: false }],
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

/* ---------- rotation ---------- */

test('campaign eligibility stops at end date, purchased rides, pause and future start', () => {
  assert.equal(campaignBlockReason(campaign(), NOW), null)
  assert.equal(campaignBlockReason(campaign({ ends_at: new Date(NOW - 1).toISOString() }), NOW), 'ended_date')
  assert.equal(campaignBlockReason(campaign({ rides_served: 3 }), NOW), 'rides_reached')
  assert.equal(campaignBlockReason(campaign({ status: 'paused' }), NOW), 'status_paused')
  assert.equal(campaignBlockReason(campaign({ starts_at: new Date(+NOW + DAY).toISOString() }), NOW), 'not_started')
  assert.deepEqual(campaignsToEnd([campaign({ id: 'a', rides_served: 9 }), campaign({ id: 'b' }), campaign({ id: 'c', status: 'paused', rides_served: 9 })], NOW), [{ id: 'a', reason: 'rides_reached' }])
})

test('weights follow placement, frequency and the game-day boost', () => {
  assert.equal(adWeight({ placement: 'standard', frequency: 1 }), 1)
  assert.equal(adWeight({ placement: 'first_in_loop', frequency: 2 }), 4)
  assert.equal(adWeight({ placement: 'takeover', frequency: 1, game_day_boost: 3 }), 1, 'takeover is a normal slot off game day')
  assert.equal(adWeight({ placement: 'takeover', frequency: 1, game_day_boost: 3 }, { gameDay: true }), 12)
})

test('loop puts first-in-loop ads first, spreads by weight and skips unapproved or ended ads', () => {
  const items = [
    { id: 'std', campaign: campaign({ id: 'std' }), pkg: pkg(), creative: creative({ id: 'std' }) },
    { id: 'lead', campaign: campaign({ id: 'lead' }), pkg: pkg({ placement: 'first_in_loop', frequency: 2, slot_seconds: 15 }), creative: creative({ id: 'lead' }) },
    { id: 'gd', campaign: campaign({ id: 'gd', rides_purchased: null }), pkg: pkg({ placement: 'takeover', game_day_boost: 3 }), creative: creative({ id: 'gd' }) },
    { id: 'pending', campaign: campaign({ id: 'pending' }), pkg: pkg(), creative: creative({ id: 'pending', approval_status: 'pending_review' }) },
    { id: 'done', campaign: campaign({ id: 'done', rides_served: 3 }), pkg: pkg(), creative: creative({ id: 'done' }) },
  ]
  const weekday = buildLoop(items, { now: NOW, gameDay: false })
  assert.equal(weekday[0].id, 'lead')
  assert.equal(weekday[0].seconds, 15)
  assert.equal(weekday.length, 6)
  const count = (loop, id) => loop.filter((s) => s.id === id).length
  assert.equal(count(weekday, 'lead'), 4)
  assert.equal(count(weekday, 'std'), 1)
  assert.equal(count(weekday, 'pending') + count(weekday, 'done'), 0)
  const gameday = buildLoop(items, { now: SATURDAY, gameDay: true })
  assert.ok(count(gameday, 'gd') > count(gameday, 'lead'), 'takeover dominates on game day')
  assert.equal(buildLoop([], { now: NOW }).length, 0)
})

/* ---------- sign-up rules ---------- */

test('sign-up validation covers upload and build modes', () => {
  assert.deepEqual(Object.keys(signupErrors({})).sort(), ['businessName', 'contactName', 'creativeMode', 'email', 'phone'])
  const base = { businessName: 'TEST Biz', contactName: 'Pat', email: 'p@example.test', phone: '864 555 0100' }
  assert.ok(signupErrors({ ...base, creativeMode: 'build' }).dealText)
  assert.deepEqual(signupErrors({ ...base, creativeMode: 'build', headline: 'TEST Biz', dealText: '15% off' }), {})
  assert.ok(signupErrors({ ...base, creativeMode: 'upload', storagePath: '../etc/passwd', contentType: 'image/png' }).storagePath)
  assert.ok(signupErrors({ ...base, creativeMode: 'upload', storagePath: uploadPathFor('11111111-1111-4111-8111-111111111111', 'a.exe'), contentType: 'application/x-msdownload' }).storagePath)
  assert.deepEqual(signupErrors({ ...base, creativeMode: 'upload', storagePath: uploadPathFor('11111111-1111-4111-8111-111111111111', 'My Ad.PNG'), contentType: 'image/png' }), {})
  assert.ok(signupErrors({ ...base, creativeMode: 'build', headline: 'x y', dealText: 'deal', qrUrl: 'javascript:alert(1)' }).qrUrl)
  assert.equal(uploadErrors({ contentType: 'video/mp4', size: 1000 }), null)
  assert.match(uploadErrors({ contentType: 'video/mp4', size: 60 * 1024 * 1024 }), /50 MB/)
})

/* ---------- API ---------- */

test('signup creates a pending partner, a pending_payment campaign and a pending_review creative', async () => {
  const db = fakeAdsDb(seed())
  const sent = []
  const handler = createAdsHandler({ db: () => db, auth: async () => null, limit: () => true, recipients: () => ['admin@example.test'], send: async (m) => { sent.push(m); return { emailed: true } } })
  const r = await call(handler, { method: 'POST', action: 'signup', body: { businessName: 'TEST Tacos', contactName: 'Pat', email: 'PAT@example.test', phone: '8645550100', packageId: 'local', creativeMode: 'build', headline: 'TEST Tacos', dealText: '15% off', qrUrl: 'https://example.test/deal' } })
  assert.equal(r.statusCode, 200, r.body)
  assert.equal(r.json.status, 'pending_payment')
  assert.equal(r.json.creativeStatus, 'pending_review')
  const partner = db.tables.ad_partners.at(-1)
  assert.equal(partner.status, 'pending')
  assert.equal(partner.email, 'pat@example.test')
  const c = db.tables.ad_campaigns.at(-1)
  assert.equal(c.partner_id, partner.id)
  assert.equal(c.rides_purchased, 3)
  assert.equal(c.price_cents, 20000)
  assert.equal(db.tables.ad_creatives.at(-1).kind, 'built')
  assert.match(sent[0].subject, /New ad partner: TEST Tacos/)
})

test('signup refuses placeholder packages, honours the honeypot and the rate limit', async () => {
  const db = fakeAdsDb(seed())
  let allow = true
  const handler = createAdsHandler({ db: () => db, auth: async () => null, limit: () => allow, recipients: () => [] })
  const good = { businessName: 'TEST Tacos', contactName: 'Pat', email: 'p@example.test', phone: '8645550100', creativeMode: 'build', headline: 'TEST', dealText: 'Deal' }
  const ph = await call(handler, { method: 'POST', action: 'signup', body: { ...good, packageId: 'ph' } })
  assert.equal(ph.statusCode, 400)
  assert.ok(ph.json.errors.packageId)
  const before = db.tables.ad_partners.length
  assert.equal((await call(handler, { method: 'POST', action: 'signup', body: { ...good, website2: 'spam' } })).statusCode, 200)
  allow = false
  assert.equal((await call(handler, { method: 'POST', action: 'signup', body: good })).statusCode, 429)
  assert.equal(db.tables.ad_partners.length, before, 'placeholder, bot and rate-limited sign-ups store nothing (placeholder fails before insert)')
  const founding = createAdsHandler({ db: () => db, auth: async () => null, limit: () => true, recipients: () => [] })
  const ok = await call(founding, { method: 'POST', action: 'signup', body: good })
  assert.equal(ok.statusCode, 200)
  assert.equal(db.tables.ad_campaigns.at(-1).package_id, null, 'founding partner has no package yet')
})

test('upload-url hands out a pending/ path for allowed types only', async () => {
  const db = fakeAdsDb(seed())
  const handler = createAdsHandler({ db: () => db, limit: () => true })
  const ok = await call(handler, { method: 'POST', action: 'upload-url', body: { filename: 'Deal Ad.mp4', contentType: 'video/mp4', size: 2_000_000 } })
  assert.equal(ok.statusCode, 200)
  assert.match(ok.json.path, /^pending\/[0-9a-f-]{36}\/deal-ad\.mp4$/)
  assert.equal(ok.json.kind, 'video')
  assert.equal((await call(handler, { method: 'POST', action: 'upload-url', body: { filename: 'x.svg', contentType: 'image/svg+xml', size: 10 } })).statusCode, 400)
})

test('admin actions are owner-only', async () => {
  assert.equal(isAdsOwner(OWNER), true)
  assert.equal(isAdsOwner(OTHER_ADMIN), false)
  assert.equal(isAdsOwner({ email: 'john@gmail.com' }), false)
  const db = fakeAdsDb(seed())
  const as = (user) => createAdsHandler({ db: () => db, auth: async () => user })
  assert.equal((await call(as(null), { action: 'admin-overview' })).statusCode, 401)
  assert.equal((await call(as(OTHER_ADMIN), { action: 'admin-overview' })).statusCode, 403)
  const ok = await call(as(OWNER), { action: 'admin-overview' })
  assert.equal(ok.statusCode, 200)
  assert.equal(ok.json.campaigns.length, 1)
})

test('admin approves creatives, activates/pauses campaigns and pairs a tablet', async () => {
  const s = seed()
  s.ad_campaigns = [campaign({ status: 'pending_payment', starts_at: null, ends_at: null, rides_purchased: null })]
  s.ad_creatives = [creative({ approval_status: 'pending_review' })]
  const db = fakeAdsDb(s)
  const h = createAdsHandler({ db: () => db, auth: async () => OWNER, now: () => NOW })
  assert.equal((await call(h, { method: 'POST', action: 'admin-creative', body: { id: 'cr1', decision: 'approved', deal_text: 'Edited deal' } })).statusCode, 200)
  assert.equal(db.tables.ad_creatives[0].approval_status, 'approved')
  assert.equal(db.tables.ad_creatives[0].deal_text, 'Edited deal')
  const act = await call(h, { method: 'POST', action: 'admin-campaign', body: { id: 'c1', action: 'activate' } })
  assert.equal(act.statusCode, 200, act.body)
  const c = db.tables.ad_campaigns[0]
  assert.equal(c.status, 'active')
  assert.equal(c.starts_at, NOW.toISOString())
  assert.equal(Date.parse(c.ends_at) - Date.parse(c.starts_at), 30 * DAY)
  assert.equal(c.rides_purchased, 3)
  await call(h, { method: 'POST', action: 'admin-campaign', body: { id: 'c1', action: 'pause' } })
  assert.equal(db.tables.ad_campaigns[0].status, 'paused')
  const pair = await call(h, { method: 'POST', action: 'admin-device', body: { label: 'Car 2', driverId: 'drv2' } })
  assert.match(pair.json.token, /^crt_/)
  const stored = db.tables.ad_devices.at(-1)
  assert.equal(stored.token_hash, hashDeviceToken(pair.json.token))
  assert.equal(JSON.stringify(db.tables.ad_devices).includes(pair.json.token), false, 'only the hash is stored')
})

/* ---------- tablet ---------- */

test('tablet feed needs a paired token and returns the loop, creatives and trip state', async () => {
  const s = seed()
  s.trips = [{ id: 't1', driver_id: 'drv1', status: 'in_progress' }]
  const db = fakeAdsDb(s)
  const h = createAdsHandler({ db: () => db, now: () => NOW })
  assert.equal((await call(h, { action: 'tablet-feed' })).statusCode, 401)
  assert.equal((await call(h, { action: 'tablet-feed', headers: { 'x-device-token': 'crt_wrong_token_1234567' } })).statusCode, 401)
  const r = await call(h, { action: 'tablet-feed', headers: { 'x-device-token': 'crt_test_token_123456' } })
  assert.equal(r.statusCode, 200)
  assert.equal(r.json.trip.id, 't1')
  assert.equal(r.json.loop[0].creativeId, 'cr1')
  assert.equal(r.json.creatives.cr1.headline, 'TEST Biz')
  assert.ok(db.tables.ad_devices[0].last_seen_at)
})

test('impressions count one ride per campaign per in-progress trip and end the campaign at the limit', async () => {
  const s = seed()
  s.ad_campaigns = [campaign({ rides_purchased: 2 })]
  s.trips = [{ id: 't1', driver_id: 'drv1', status: 'in_progress' }]
  const db = fakeAdsDb(s)
  const device = db.tables.ad_devices[0]
  const imp = (n, extra = {}) => ({ clientId: `c${n}`, campaignId: 'c1', creativeId: 'cr1', shownAt: NOW.toISOString(), seconds: 10, inTrip: true, ...extra })
  const a = await recordImpressions(db, device, [imp(1), imp(2)], { now: NOW })
  assert.deepEqual([a.stored, a.ridesCounted, a.trip], [2, 1, 't1'])
  const again = await recordImpressions(db, device, [imp(1), imp(3)], { now: NOW })
  assert.equal(again.ridesCounted, 0, 'same trip does not count twice')
  assert.equal(db.tables.ad_impressions.length, 3, 'duplicate clientId ignored')
  db.tables.trips[0].status = 'completed'
  db.tables.trips.push({ id: 't2', driver_id: 'drv1', status: 'in_progress' })
  const second = await recordImpressions(db, device, [imp(4)], { now: NOW })
  assert.equal(second.ridesCounted, 1)
  assert.equal(db.tables.ad_campaigns[0].rides_served, 2)
  assert.equal(db.tables.ad_campaigns[0].status, 'ended')
  const feed = await tabletFeed(db, device, { now: NOW })
  assert.equal(feed.loop.length, 0, 'ended campaign leaves the rotation')
  const noTrip = await recordImpressions(db, { ...device }, [imp(5, { inTrip: false })], { now: NOW })
  assert.equal(noTrip.ridesCounted, 0)
})

test('demo tablets log impressions but never count rides', async () => {
  const s = seed()
  s.trips = [{ id: 't1', driver_id: 'drv1', status: 'in_progress' }]
  const db = fakeAdsDb(s)
  const out = await recordImpressions(db, { ...db.tables.ad_devices[0], demo: true }, [{ clientId: 'x', campaignId: 'c1', creativeId: 'cr1', shownAt: NOW.toISOString(), seconds: 8, inTrip: true }], { now: NOW })
  assert.equal(out.ridesCounted, 0)
  assert.equal(db.tables.ad_campaigns[0].rides_served, 0)
})

test('feed sweeps campaigns past their end date', async () => {
  const s = seed()
  s.ad_campaigns = [campaign({ ends_at: new Date(NOW - 1000).toISOString() })]
  const db = fakeAdsDb(s)
  const feed = await tabletFeed(db, db.tables.ad_devices[0], { now: NOW })
  assert.equal(feed.loop.length, 0)
  assert.equal(db.tables.ad_campaigns[0].status, 'ended')
  assert.equal(db.tables.ad_campaigns[0].ended_reason, 'ended_date')
})

/* ---------- billing (Stripe mocks only) ---------- */

function mockStripe() {
  const calls = []
  const rec = (name, ret) => async (...args) => { calls.push([name, ...args]); return typeof ret === 'function' ? ret(...args) : ret }
  return {
    calls,
    customers: { create: rec('customers.create', { id: 'cus_test' }) },
    invoices: {
      create: rec('invoices.create', { id: 'in_test' }),
      finalizeInvoice: rec('invoices.finalize', { id: 'in_test', hosted_invoice_url: 'https://invoice.stripe.test/i/in_test' }),
    },
    invoiceItems: { create: rec('invoiceItems.create', { id: 'ii_test' }) },
    checkout: { sessions: { create: rec('checkout.create', { id: 'cs_test', url: 'https://checkout.stripe.test/cs_test' }) } },
    products: { create: rec('products.create', (p) => ({ id: `prod_${p.metadata.package_id}` })) },
    prices: { create: rec('prices.create', (p) => ({ id: `price_${p.metadata.package_id}_${p.unit_amount}` })), retrieve: rec('prices.retrieve', { unit_amount: 20000, currency: 'usd' }) },
  }
}

test('billing is off by default and refuses placeholder or unpriced packages', async () => {
  assert.equal(adsBillingEnabled({}), false)
  assert.equal(adsBillingEnabled({ ADS_BILLING_ENABLED: 'true' }), true)
  const db = fakeAdsDb(seed())
  const stripe = mockStripe()
  assert.deepEqual(await startCampaignPayment({ stripe, sb: db, campaignId: 'c1', env: {} }), { skipped: true, reason: 'ADS_BILLING_ENABLED is off' })
  assert.equal(stripe.calls.length, 0)
  db.tables.ad_campaigns.push(campaign({ id: 'c-ph', package_id: 'ph' }))
  await assert.rejects(startCampaignPayment({ stripe, sb: db, campaignId: 'c-ph', env: { ADS_BILLING_ENABLED: 'true' } }), /Placeholder/)
  db.tables.ad_campaigns.push(campaign({ id: 'c-free', package_id: null, price_cents: null }))
  await assert.rejects(startCampaignPayment({ stripe, sb: db, campaignId: 'c-free', env: { ADS_BILLING_ENABLED: 'true' } }), /Set a price/)
  assert.equal(campaignAmountCents({ price_cents: 5000 }, pkg()), 5000, 'a quoted founding price wins')
})

test('invoice and checkout modes create a customer and save the payment link (mocked Stripe)', async () => {
  const db = fakeAdsDb(seed())
  const stripe = mockStripe()
  const env = { ADS_BILLING_ENABLED: 'true' }
  const inv = await startCampaignPayment({ stripe, sb: db, campaignId: 'c1', env })
  assert.equal(inv.payment_url, 'https://invoice.stripe.test/i/in_test')
  assert.equal(db.tables.ad_partners[0].stripe_customer_id, 'cus_test')
  assert.equal(db.tables.ad_campaigns[0].status, 'pending_payment')
  const item = stripe.calls.find((c) => c[0] === 'invoiceItems.create')[1]
  assert.equal(item.amount, 20000)
  assert.equal(item.metadata.kind, 'ad_campaign')
  const co = await startCampaignPayment({ stripe, sb: db, campaignId: 'c1', mode: 'checkout', env })
  assert.equal(co.payment_url, 'https://checkout.stripe.test/cs_test')
  assert.equal(stripe.calls.filter((c) => c[0] === 'customers.create').length, 1, 'customer reused')
})

test('invoice.paid / checkout.session.completed with ad_campaign metadata activate the campaign', async () => {
  const s = seed()
  s.ad_campaigns = [campaign({ status: 'pending_payment', starts_at: null, ends_at: null, rides_purchased: null })]
  s.ad_partners[0].status = 'pending'
  const db = fakeAdsDb(s)
  const ev = { type: 'invoice.paid', data: { object: { object: 'invoice', id: 'in_1', metadata: { kind: 'ad_campaign', campaign_id: 'c1' } } } }
  assert.equal(isAdsStripeEvent(ev), true)
  assert.equal(isAdsStripeEvent({ type: 'invoice.paid', data: { object: { metadata: { kind: 'tiger_pass' } } } }), false)
  const out = await handleAdsStripeEvent(db, ev, { now: NOW })
  assert.deepEqual(out, { ok: true, activated: 'c1' })
  const c = db.tables.ad_campaigns[0]
  assert.equal(c.status, 'active')
  assert.equal(c.rides_purchased, 3)
  assert.equal(Date.parse(c.ends_at) - Date.parse(c.starts_at), 30 * DAY)
  assert.equal(db.tables.ad_partners[0].status, 'active')
  assert.deepEqual(await handleAdsStripeEvent(db, ev, { now: NOW }), { ok: true, already: true })
  const unpaid = await handleAdsStripeEvent(db, { type: 'checkout.session.completed', data: { object: { object: 'checkout.session', payment_status: 'unpaid', metadata: { kind: 'ad_campaign', campaign_id: 'c1' } } } })
  assert.equal(unpaid.reason, 'not_paid')
})

test('the existing /api/stripe/webhook routes ad_campaign events to the ads handler', async () => {
  const seen = []
  const event = { id: 'evt_1', type: 'invoice.paid', data: { object: { object: 'invoice', id: 'in_1', metadata: { kind: 'ad_campaign', campaign_id: 'c1' } } } }
  const r = res()
  await stripeWebhook({ method: 'POST', headers: {}, rawBody: Buffer.from(JSON.stringify(event)) }, r, {
    stripeSecret: 'sk_test_x', webhookSecret: '', allowUnsigned: true, serviceClient: () => ({}),
    handleAdsStripeEvent: async (_c, e) => { seen.push(e.type); return { ok: true, activated: 'c1' } },
  })
  assert.equal(r.statusCode, 200)
  assert.deepEqual(seen, ['invoice.paid'])
  assert.equal(JSON.parse(r.body).ads.activated, 'c1')
})

test('sync script plans only approved priced packages and creates products/prices with mocks', async () => {
  const packages = [pkg(), pkg({ id: 'ph', placeholder: true }), pkg({ id: 'off', active: false }), pkg({ id: 'free', price_cents: 0 })]
  assert.deepEqual(planPackageSync(packages).map((p) => `${p.id}:${p.action}`), ['local:create_product_and_price', 'ph:skip', 'off:skip', 'free:skip'])
  const db = fakeAdsDb({ ad_packages: packages })
  const stripe = mockStripe()
  const out = await applyPackageSync({ stripe, sb: db, packages })
  assert.equal(out[0].stripe_price_id, 'price_local_20000')
  assert.equal(db.tables.ad_packages[0].stripe_product_id, 'prod_local')
  assert.equal(stripe.calls.filter((c) => c[0] === 'products.create').length, 1)
})

/* ---------- automation ---------- */

test('automation plans reminders, unpaid pauses, ending notices and monthly reports', () => {
  const firstOfMonth = new Date('2026-11-01T14:00:00Z')
  const plan = planAdsAutomation([
    { id: 'remind', status: 'pending_payment', payment_url: 'u', updated_at: new Date(+NOW - 2 * DAY).toISOString() },
    { id: 'pause', status: 'pending_payment', payment_url: 'u', updated_at: new Date(+NOW - 15 * DAY).toISOString() },
    { id: 'nolink', status: 'pending_payment', updated_at: new Date(+NOW - 15 * DAY).toISOString() },
    { id: 'ending', status: 'active', ends_at: new Date(+NOW + 2 * DAY).toISOString() },
    { id: 'noticed', status: 'active', ends_at: new Date(+NOW + 2 * DAY).toISOString(), ending_notice_at: NOW.toISOString() },
  ], NOW)
  assert.deepEqual(plan.map((p) => `${p.campaignId}:${p.kind}`), ['remind:invoice_reminder', 'pause:pause_unpaid', 'ending:ending_notice'])
  const report = planAdsAutomation([{ id: 'r', status: 'active', ends_at: '2027-01-01T00:00:00Z' }], firstOfMonth)
  assert.deepEqual(report.map((p) => [p.kind, p.month]), [['monthly_report', '2026-10']])
})

test('cron is plan-only and sends nothing while the flags are off; flags on write and email', async () => {
  const s = seed()
  s.ad_campaigns = [campaign({ id: 'u', status: 'pending_payment', payment_url: 'https://invoice.stripe.test/x', updated_at: new Date(+NOW - 20 * DAY).toISOString() })]
  const db = fakeAdsDb(s)
  const sent = []
  const send = async (m) => { sent.push(m); return { emailed: true } }
  const h = createAdsHandler({ db: () => db, env: { CRON_SECRET: 'cron-secret' }, now: () => NOW, send })
  assert.equal((await call(h, { action: 'cron' })).statusCode, 401)
  const dry = await call(h, { method: 'POST', action: 'cron', headers: { authorization: 'Bearer cron-secret' } })
  assert.equal(dry.statusCode, 200, dry.body)
  assert.equal(dry.json.dryRun, true)
  assert.equal(dry.json.plan[0].kind, 'pause_unpaid')
  assert.equal(db.tables.ad_campaigns[0].status, 'pending_payment')
  assert.equal(sent.length, 0)
  const live = await runAdsAutomation({ sb: db, env: { ADS_AUTOMATION_ENABLED: 'true', ADS_PARTNER_EMAILS_ENABLED: 'true' }, now: NOW, send })
  assert.equal(live.plan[0].wrote, true)
  assert.equal(db.tables.ad_campaigns[0].status, 'paused')
  assert.equal(sent[0].to, 'pat@example.test')
  const staging = createAdsHandler({ db: () => db, env: { CRON_SECRET: 'cron-secret', DISABLE_CRON_ENDPOINTS: '1' } })
  assert.equal((await call(staging, { method: 'POST', action: 'cron', headers: { authorization: 'Bearer cron-secret' } })).statusCode, 403)
})
