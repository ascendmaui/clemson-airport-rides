import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getHashRoute } from '../src/lib/navigation.js'
import { campaignMetrics, boostQuote, METRIC_DEFINITIONS } from '../shared/ads/metrics.js'
import { SAMPLE_ADS_APPROVED, approvedSamples, sampleById } from '../src/content/sampleAds.js'
import { HERO_DEMO_APPROVED, HOW_IT_WORKS_VIDEO } from '../src/content/advertiseMedia.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const BANNED = new RegExp(['te' + 'sla', 'self' + '-driving', 'robo' + 'taxi', 'andr' + 'oid', 'play ' + 'store', 'google ' + 'play', 'tiger ' + 'paw', 'toomer'].join('|'), 'i')

async function load(entry) {
  const built = await esbuild.build({
    absWorkingDir: fileURLToPath(root), entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', write: false,
    loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@supabase/supabase-js', 'qrcode'],
  })
  const dir = mkdtempSync(join(fileURLToPath(root), '.ads-partner-'))
  try {
    const file = join(dir, 'm.mjs')
    writeFileSync(file, built.outputFiles[0].text)
    return await import(pathToFileURL(file).href)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const noopApi = { fetchMyAds: async () => ({}), fetchAdPackages: async () => ({ packages: [] }), savePartnerCampaign: async () => ({}), launchPartnerCampaign: async () => ({}), boostCampaign: async () => ({}), uploadAdCreative: async () => ({}) }

function dashData({ onboarded = true } = {}) {
  const c = { id: 'c1', name: 'TEST Tiger Tavern · 1,000 rides', status: 'active', rides_purchased: 1000, rides_served: 2, price_cents: 8900, targeting: { radius_mi: 3, routes: ['stadium'] }, game_day_boost: true, ad_creatives: [{ id: 'cr1', headline: 'TEST Tiger Tavern', approval_status: 'approved' }] }
  const metrics = campaignMetrics({
    campaign: c,
    impressions: [{ trip_id: 't1', visible: true, seconds_shown: 10 }, { trip_id: null, visible: true, seconds_shown: 10 }],
    rideCounts: [{ trip_id: 't1', counted_at: '2026-10-14T16:00:00Z' }, { trip_id: 't2', counted_at: '2026-10-14T17:00:00Z' }],
    scans: [{ trip_id: 't1', duplicate: false }],
  })
  return {
    onboarded,
    partners: [{ id: 'p1', business_name: 'TEST Tiger Tavern', status: onboarded ? 'active' : 'pending' }],
    campaigns: [{ ...c, metrics, creativeRanking: [], boosts: [], boostQuote: boostQuote(c) }],
    refreshedAt: '2026-10-14T16:00:00Z',
  }
}

test('/advertise/apply routes to the founding-partner application', () => {
  const prev = globalThis.window
  globalThis.window = { location: { hash: '', pathname: '/advertise/apply', search: '', origin: 'https://clemsonrides.com', replace() {} }, sessionStorage: { getItem() { return null }, setItem() {} } }
  try {
    const r = getHashRoute()
    assert.deepEqual([r.path, r.params.sub], ['advertise', 'apply'])
  } finally {
    if (prev === undefined) delete globalThis.window
    else globalThis.window = prev
  }
})

test('analytics page: four distinct counters with tooltips, QR scans first, rides list, CSV and boost', async () => {
  const mod = await load('src/screens/AdsSignup.jsx')
  const html = renderToStaticMarkup(createElement(mod.PartnerDashboardView, { api: noopApi, data: dashData(), user: { id: 'u', email: 'pat@example.test' } }))
  const order = [...html.matchAll(/data-metric="(\w+)"/g)].map((m) => m[1])
  assert.deepEqual(order, ['scans', 'rides', 'impressions', 'runs'])
  for (const k of ['scans', 'rides', 'impressions', 'runs']) {
    const def = METRIC_DEFINITIONS[k].replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, '&#x27;')
    assert.match(html, new RegExp(`role="tooltip"[^>]*>${def}`), k)
  }
  assert.match(html, /data-metric="rides"><span class="ads-metric-value">2<\/span>/)
  assert.match(html, /data-metric="runs"><span class="ads-metric-value">2<\/span>/)
  assert.match(html, /data-metric="impressions"><span class="ads-metric-value">1<\/span>/)
  assert.match(html, /data-metric="scans"><span class="ads-metric-value">1<\/span>/)
  assert.match(html, /50% of rides/)
  assert.match(html, /class="ads-chip ads-chip--pending_review"|class="ads-chip ads-chip--live"/)
  assert.match(html, /Every ride your ad ran on \(2\)/)
  assert.match(html, /R-T1/)
  assert.match(html, /Download CSV/)
  assert.match(html, /Boost: double remaining rides/)
  assert.match(html, /Stadium runs \(game day\) · within 3 mi/)
  assert.match(html, /Build My Ad/)
  assert.match(html, /Create My Campaign/)
  assert.match(html, /Launch My Campaign/)
  assert.match(html, /refresh every 15 seconds/)
  assert.equal(BANNED.test(html), false)
})

test('partners who are not onboarded see the onboarding prompt instead of the self-serve sections', async () => {
  const mod = await load('src/screens/AdsSignup.jsx')
  const html = renderToStaticMarkup(createElement(mod.PartnerDashboardView, { api: noopApi, data: dashData({ onboarded: false }), user: { id: 'u', email: 'pat@example.test' } }))
  assert.match(html, /data-testid="ads-onboarding"/)
  assert.doesNotMatch(html, /Create My Campaign/)
})

test('founding-partner application form asks about six things and carries a honeypot', async () => {
  const mod = await load('src/screens/AdsSignup.jsx')
  const html = renderToStaticMarkup(createElement(mod.FoundingApplicationForm, { api: { submitFoundingApplication: async () => ({}) } }))
  for (const name of ['businessName', 'category', 'address', 'contactName', 'email', 'phone', 'website', 'promote', 'offer', 'company_url']) assert.match(html, new RegExp(`name="${name}"`), name)
  assert.match(html, /Limited spots/)
})

test('sample ads, the hero demo and the How it Works video are not placed until John approves them', async () => {
  assert.equal(SAMPLE_ADS_APPROVED, false)
  assert.equal(HERO_DEMO_APPROVED, false)
  assert.equal(HOW_IT_WORKS_VIDEO, null)
  assert.deepEqual(approvedSamples(), [])
  assert.equal(sampleById('tiger-tavern'), null)
  const sample = [{ id: 's1', headline: 'TEST Sample', dealText: 'Deal', theme: 'orange' }]
  assert.deepEqual(approvedSamples(sample, true).map((s) => s.id), ['s1'])
  const mod = await load('src/screens/Advertise.jsx')
  assert.equal(renderToStaticMarkup(createElement(mod.SampleAdsGallery)), '')
  assert.equal(renderToStaticMarkup(createElement(mod.HeroTabletDemo)), '')
  assert.equal(renderToStaticMarkup(createElement(mod.HowItWorksVideo)), '')
  const gallery = renderToStaticMarkup(createElement(mod.SampleAdsGallery, { samples: sample }))
  assert.match(gallery, /href="\/advertise\/signup\?template=s1"/)
  assert.match(gallery, /Run an ad similar to this/)
  const video = renderToStaticMarkup(createElement(mod.HowItWorksVideo, { video: { src: '/ads/how-it-works.mp4', poster: '/ads/how-it-works-poster.jpg' } }))
  assert.match(video, /<video[^>]*src="\/ads\/how-it-works\.mp4"[^>]*poster="\/ads\/how-it-works-poster\.jpg"[^>]*controls=""[^>]*muted=""[^>]*playsinline=""/)
  const demo = renderToStaticMarkup(createElement(mod.HeroTabletDemo, { samples: sample, enabled: true }))
  assert.match(demo, /TEST Sample/)
})

test('new ads sources keep the product locks', () => {
  for (const p of ['server/ads/tracking.js', 'shared/ads/metrics.js', 'shared/ads/targeting.js', 'shared/ads/application.js', 'src/screens/AdsSignup.jsx', 'src/screens/Advertise.jsx', 'src/content/adPackages.js', 'src/content/sampleAds.js', 'src/components/AdsAdminPanel.jsx', 'supabase/migrations/20261017100000_ad_tracking_selfserve.sql']) {
    assert.equal(BANNED.test(read(p)), false, p)
  }
})

test('AI co-pilot panel renders nothing while the server flag is off, and only offers images when configured', async () => {
  const mod = await load('src/screens/AdsSignup.jsx')
  const api = { ...noopApi, copilotSuggest: async () => ({}), copilotImage: async () => ({}) }
  const current = { headline: '', dealText: '', theme: 'purple' }
  assert.equal(renderToStaticMarkup(createElement(mod.CopilotPanel, { api, copilot: null, current, onApply() {} })), '')
  assert.equal(renderToStaticMarkup(createElement(mod.CopilotPanel, { api, copilot: { enabled: false }, current, onApply() {} })), '')
  const on = renderToStaticMarkup(createElement(mod.CopilotPanel, { api, copilot: { enabled: true, text: 'templates', image: false }, current, onApply() {} }))
  assert.match(on, /data-testid="ads-copilot"/)
  assert.match(on, />Suggest</)
  assert.doesNotMatch(on, /16:9 image/)
  const withImg = renderToStaticMarkup(createElement(mod.CopilotPanel, { api, copilot: { enabled: true, image: true }, current, onApply() {} }))
  assert.match(withImg, /Make a 16:9 image/)
  const builder = renderToStaticMarkup(createElement(mod.CampaignBuilder, { partner: { business_name: 'TEST' }, api, packages: [] }))
  assert.doesNotMatch(builder, /ads-copilot/)
})
