import assert from 'node:assert/strict'
import test from 'node:test'
import { fakeAdsDb } from './helpers/fakeAdsDb.js'
import { createAdsHandler } from '../api/ads.js'
import {
  COST_CENTS, categoryKey, checkCaps, copilotEnabled, copilotImage, copilotSave, copilotSuggest, copilotVideo, providerStatus, sanitizeSuggestion,
} from '../server/ads/copilot.js'
import { copyIssues, isBlocked, withAgeNote } from '../shared/ads/copilotSafety.js'

const T = 'Te' + 'sla'
const SD = 'Self' + '-driving'
const NOW = new Date('2026-10-17T16:00:00Z')
const ON = { ADS_AI_COPILOT_ENABLED: 'true' }
const USER = { id: 'u-partner', email: 'pat@example.test' }
const STRANGER = { id: 'u-x', email: 'x@example.test' }
const mockModel = (text) => ({ resolveLanguageModel: () => ({ model: { id: 'mock' }, provider: 'mock' }), generateText: async (args) => { mockModel.last = args; return { text } } })

function seed(over = {}) {
  return {
    ad_partners: [
      { id: 'p1', profile_id: USER.id, business_name: 'Tiger Tavern', category: 'Bar or restaurant', email: USER.email, status: 'active' },
      { id: 'p2', profile_id: 'u-pending', business_name: 'Pending Co', email: 'p@example.test', status: 'pending' },
    ],
    ad_campaigns: [
      { id: 'c1', partner_id: 'p1', status: 'draft', destination_url: 'https://tigertavern.example/deal' },
      { id: 'c2', partner_id: 'p1', status: 'active', destination_url: null },
    ],
    ad_creatives: [],
    ...over,
  }
}

test('flag defaults off; every co-pilot action refuses while off and no model is called', async () => {
  assert.equal(copilotEnabled({}), false)
  assert.equal(copilotEnabled({ ADS_AI_COPILOT_ENABLED: 'false' }), false)
  const db = fakeAdsDb(seed())
  let called = false
  const deps = { env: {}, now: NOW, resolveLanguageModel: () => { called = true; return null } }
  for (const fn of [copilotSuggest, copilotImage, copilotVideo, copilotSave]) {
    await assert.rejects(fn(db, USER, { campaignId: 'c1', prompt: 'x', headline: 'x' }, deps), (e) => e.status === 404)
  }
  assert.equal(called, false)
  assert.equal(db.tables.ad_ai_usage.length, 0)
})

test('provider status reports names only and what is needed, never key values', () => {
  const none = providerStatus({})
  assert.equal(none.text, 'templates')
  assert.equal(none.image, null)
  assert.equal(none.video, null)
  assert.ok(none.needs.some((n) => /ADS_AI_IMAGE_MODEL/.test(n)))
  const withKey = providerStatus({ AI_GATEWAY_API_KEY: 'gw_secret_value_123', ADS_AI_IMAGE_MODEL: 'openai/gpt-image-1' })
  assert.equal(withKey.text, 'gateway')
  assert.equal(withKey.image, 'gateway')
  assert.doesNotMatch(JSON.stringify(withKey), /gw_secret_value_123/)
  assert.equal(providerStatus({ OPENAI_API_KEY: 'placeholder' }).text, 'templates')
})

test('safety filter: alcohol to minors, university trademarks and car-brand/driverless claims are blocked; drink copy gets 21+', () => {
  assert.ok(isBlocked(copyIssues('Freshmen drink free tonight')))
  assert.ok(isBlocked(copyIssues('Cheap beer, no ID needed for under 21')))
  assert.ok(isBlocked(copyIssues('Official partner of Clemson University')))
  assert.ok(isBlocked(copyIssues('Tiger Paw wings special')))
  assert.ok(isBlocked(copyIssues(`Ride in a ${T} to our store`)))
  assert.ok(isBlocked(copyIssues(`${SD} discount`)))
  assert.ok(isBlocked(copyIssues("Meet at Toomer's Corner")))
  const drinks = copyIssues('$3 drafts before kickoff')
  assert.deepEqual(drinks.map((i) => i.code), ['alcohol_21'])
  assert.equal(isBlocked(drinks), false)
  assert.equal(withAgeNote('$3 drafts before kickoff'), '$3 drafts before kickoff. 21+ with ID.')
  assert.deepEqual(copyIssues('$3 drafts before kickoff, 21+'), [])
  assert.deepEqual(copyIssues('Game-day wings in Death Valley country, downtown on College Ave'), [])
})

test('suggest with a mocked model: JSON parsed, unsafe lines dropped, drink copy fixed, usage logged', async () => {
  const db = fakeAdsDb(seed())
  const reply = JSON.stringify({
    offers: ['Half-price wings before kickoff', `${T} riders get 10% off`, '$3 drafts for the game'],
    headlines: ['Wings before the game', 'Clemson University fans eat free', 'Scan for tonight'],
    dealText: '$3 drafts and half-price wings till kickoff',
    theme: 'orange', layout: 'full-bleed', notes: 'Bold game-day look',
  })
  const out = await copilotSuggest(db, USER, { idea: 'game day wings' }, { env: ON, now: NOW, ...mockModel(`Here you go: ${reply}`) })
  assert.equal(out.source, 'mock')
  assert.deepEqual(out.suggestion.offers, ['Half-price wings before kickoff', '$3 drafts for the game. 21+ with ID.'])
  assert.deepEqual(out.suggestion.headlines, ['Wings before the game', 'Scan for tonight'])
  assert.match(out.suggestion.dealText, /21\+ with ID\.$/)
  assert.equal(out.suggestion.theme, 'orange')
  assert.equal(out.suggestion.layout, 'full-bleed')
  assert.match(mockModel.last.system, /never mention car brands/)
  assert.match(mockModel.last.prompt, /Tiger Tavern/)
  assert.equal(db.tables.ad_ai_usage.length, 1)
  assert.equal(db.tables.ad_ai_usage[0].cost_cents, COST_CENTS.suggest)
})

test('iterate ("make it bolder") without any model uses templates and costs nothing', async () => {
  const db = fakeAdsDb(seed())
  const deps = { env: ON, now: NOW, resolveLanguageModel: () => null }
  const first = await copilotSuggest(db, USER, {}, deps)
  assert.equal(first.source, 'templates')
  assert.equal(categoryKey('Bar or restaurant'), 'bar')
  assert.ok(first.suggestion.offers.every((o) => !isBlocked(copyIssues(o))))
  const bolder = await copilotSuggest(db, USER, { instruction: 'make it bolder', previous: { headline: 'Wings before the game', dealText: 'Half-price wings', theme: 'purple' } }, deps)
  assert.equal(bolder.suggestion.headlines[0], 'WINGS BEFORE THE GAME')
  assert.equal(bolder.suggestion.theme, 'orange')
  assert.ok(db.tables.ad_ai_usage.every((u) => u.cost_cents === 0))
})

test('garbage model output falls back to templates; model errors do not break the page', async () => {
  const db = fakeAdsDb(seed())
  const out = await copilotSuggest(db, USER, {}, { env: ON, now: NOW, ...mockModel('not json at all') })
  assert.equal(out.source, 'templates')
  assert.ok(out.suggestion.headlines.length > 0)
  const boom = await copilotSuggest(db, USER, {}, { env: ON, now: NOW, resolveLanguageModel: () => ({ model: {} }), generateText: async () => { throw new Error('down') } })
  assert.equal(boom.source, 'templates')
})

test('per-partner daily cap and global cost cap', async () => {
  const recent = new Date(NOW - 3600_000).toISOString()
  const old = new Date(NOW - 30 * 3600_000).toISOString()
  const db = fakeAdsDb(seed({ ad_ai_usage: [
    ...Array.from({ length: 2 }, () => ({ partner_id: 'p1', kind: 'suggest', cost_cents: 1, created_at: recent })),
    ...Array.from({ length: 5 }, () => ({ partner_id: 'p1', kind: 'suggest', cost_cents: 1, created_at: old })),
  ] }))
  const env = { ...ON, ADS_AI_PARTNER_DAILY_CAP: '2' }
  await assert.rejects(copilotSuggest(db, USER, {}, { env, now: NOW, resolveLanguageModel: () => null }), (e) => e.status === 429 && /limit/.test(e.message))
  const db2 = fakeAdsDb(seed({ ad_ai_usage: [{ partner_id: 'p9', kind: 'image', cost_cents: 299, created_at: recent }] }))
  await assert.rejects(checkCaps(db2, 'p1', 'image', { env: { ADS_AI_DAILY_COST_CAP_CENTS: '300' }, now: NOW }), (e) => e.status === 429)
  const ok = await checkCaps(db2, 'p1', 'image', { env: { ADS_AI_DAILY_COST_CAP_CENTS: '400' }, now: NOW })
  assert.equal(ok.spentCents, 299)
})

test('only onboarded partners can use it', async () => {
  const db = fakeAdsDb(seed())
  await assert.rejects(copilotSuggest(db, { id: 'u-pending' }, {}, { env: ON, now: NOW }), (e) => e.status === 403)
  await assert.rejects(copilotSuggest(db, STRANGER, {}, { env: ON, now: NOW }), (e) => e.status === 403)
})

test('images: not set up -> 501 with what is needed; mocked provider uploads and logs cost; unsafe prompt refused', async () => {
  const db = fakeAdsDb(seed())
  await assert.rejects(copilotImage(db, USER, { prompt: 'wings on a bar table' }, { env: ON, now: NOW }), (e) => e.status === 501 && e.needs.some((n) => /ADS_AI_IMAGE_MODEL/.test(n)))
  const generateImage = async ({ prompt, aspectRatio }) => { generateImage.last = { prompt, aspectRatio }; return { bytes: new Uint8Array([1, 2, 3]), contentType: 'image/png' } }
  const out = await copilotImage(db, USER, { prompt: 'wings on a bar table at night' }, { env: ON, now: NOW, generateImage })
  assert.equal(out.storagePath, `copilot/p1/${NOW.getTime()}.png`)
  assert.equal(generateImage.last.aspectRatio, '16:9')
  assert.match(generateImage.last.prompt, /No text, no logos, no university insignia, no car brands/)
  assert.equal(db.tables.ad_ai_usage.at(-1).cost_cents, COST_CENTS.image)
  await assert.rejects(copilotImage(db, USER, { prompt: `a ${T} with the Tiger Paw` }, { env: ON, now: NOW, generateImage }), (e) => e.status === 400)
  await assert.rejects(copilotVideo(db, USER, {}, { env: ON }), (e) => e.status === 501 && e.needs.some((n) => /Video/.test(n)))
})

test('save: creative on own draft campaign, always pending review, safety enforced', async () => {
  const db = fakeAdsDb(seed())
  const deps = { env: ON, now: NOW }
  const { creative } = await copilotSave(db, USER, { campaignId: 'c1', headline: 'Wings before the game', dealText: '$3 drafts till kickoff', theme: 'orange' }, deps)
  assert.equal(creative.approval_status, 'pending_review')
  assert.equal(creative.kind, 'built')
  assert.equal(creative.qr_url, 'https://tigertavern.example/deal')
  assert.match(creative.deal_text, /21\+ with ID\.$/)
  assert.equal(creative.review_note, 'made with the AI co-pilot')
  const img = await copilotSave(db, USER, { campaignId: 'c1', headline: 'Pic', storagePath: `copilot/p1/${NOW.getTime()}.png` }, deps)
  assert.equal(img.creative.kind, 'image')
  const foreign = await copilotSave(db, USER, { campaignId: 'c1', headline: 'Pic', storagePath: 'copilot/p2/1.png' }, deps)
  assert.equal(foreign.creative.kind, 'built', 'cannot attach another partner\'s file')
  await assert.rejects(copilotSave(db, USER, { campaignId: 'c1', headline: `${SD} deals` }, deps), (e) => e.status === 400)
  await assert.rejects(copilotSave(db, USER, { campaignId: 'c2', headline: 'x' }, deps), (e) => e.status === 409)
  await assert.rejects(copilotSave(db, STRANGER, { campaignId: 'c1', headline: 'x' }, deps), (e) => e.status === 404)
})

test('API: actions need POST + sign-in, 404 while flag off, mine reports co-pilot off by default', async () => {
  const mk = (env, auth = async () => USER) => createAdsHandler({ db: () => fakeAdsDb(seed()), auth, env, now: () => NOW, copilot: { resolveLanguageModel: () => null } })
  const r = () => ({ statusCode: 0, body: '', headers: {}, setHeader(k, v) { this.headers[k] = v }, end(b) { this.body = b == null ? '' : String(b) } })
  const call = async (h, method, action, body) => { const x = r(); await h({ method, url: `/api/ads?action=${action}`, headers: {}, body }, x); return { status: x.statusCode, json: x.body ? JSON.parse(x.body) : null } }
  assert.equal((await call(mk(ON), 'GET', 'copilot-suggest')).status, 405)
  assert.equal((await call(mk(ON, async () => null), 'POST', 'copilot-suggest', {})).status, 401)
  assert.equal((await call(mk({}), 'POST', 'copilot-suggest', {})).status, 404)
  const ok = await call(mk(ON), 'POST', 'copilot-suggest', { idea: 'wings' })
  assert.equal(ok.status, 200)
  assert.equal(ok.json.source, 'templates')
  const img = await call(mk(ON), 'POST', 'copilot-image', { prompt: 'wings' })
  assert.equal(img.status, 501)
  assert.ok(Array.isArray(img.json.needs))
  const mine = await call(mk({}), 'GET', 'mine')
  assert.deepEqual(mine.json.copilot, { enabled: false, text: null, image: false })
})

test('sanitizeSuggestion clamps theme/layout and lengths', () => {
  const s = sanitizeSuggestion({ offers: ['x'.repeat(300)], headlines: ['y'.repeat(200)], dealText: 'ok', theme: 'neon', layout: 'diagonal' }, { theme: 'light' })
  assert.equal(s.offers[0].length, 140)
  assert.equal(s.headlines[0].length, 80)
  assert.equal(s.theme, 'light')
  assert.equal(s.layout, 'qr-right')
})
