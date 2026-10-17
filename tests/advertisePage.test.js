import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PGlite } from '@electric-sql/pglite'
import { getHashRoute } from '../src/lib/navigation.js'
import {
  ADS_PACKAGES_APPROVED, FOUNDING_PARTNER_TIER, PRICING_STATUS_COPY, RIDE_BUNDLES, bundlePackageRows, formatPerRide, perRideCents, publicAdPackages, tierChoices,
} from '../src/content/adPackages.js'
import { AD_LEAD_HONEYPOT, adLeadErrors, adLeadRow, isAdLeadBot } from '../shared/adLeads.js'
import { createAdLeadsHandler } from '../api/ad-leads.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const BANNED = new RegExp(['te' + 'sla', 'self' + '-driving', 'robo' + 'taxi', 'andr' + 'oid', 'play ' + 'store', 'google ' + 'play'].join('|'), 'i')

const GOOD = {
  businessName: 'TEST Tiger Tacos', contactName: 'Pat Doe', email: 'pat@example.test',
  phone: '(864) 555-0100', category: 'Restaurant or bar', tier: FOUNDING_PARTNER_TIER.id, message: 'Hi',
}

function routeFor(pathname) {
  const prev = globalThis.window
  globalThis.window = { location: { hash: '', pathname, search: '', origin: 'https://clemsonrides.com', replace() {} }, sessionStorage: { getItem() { return null }, setItem() {} } }
  try { return getHashRoute() } finally {
    if (prev === undefined) delete globalThis.window
    else globalThis.window = prev
  }
}

async function renderScreen(exportName) {
  const built = await esbuild.build({
    absWorkingDir: fileURLToPath(root),
    entryPoints: ['src/screens/Advertise.jsx'],
    bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', write: false,
    loader: { '.css': 'empty' },
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'qrcode'],
  })
  const dir = mkdtempSync(join(fileURLToPath(root), '.advertise-render-'))
  const file = join(dir, 'advertise.mjs')
  try {
    writeFileSync(file, built.outputFiles[0].text)
    const mod = await import(pathToFileURL(file).href)
    return renderToStaticMarkup(createElement(mod[exportName]))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function fakeRes() {
  return {
    statusCode: 0, body: '', headers: {},
    setHeader(k, v) { this.headers[k.toLowerCase()] = v },
    end(b) { this.body = b == null ? '' : String(b) },
    get json() { return this.body ? JSON.parse(this.body) : null },
  }
}

function fakeDb(inserts, { error = null } = {}) {
  return () => ({
    from(table) {
      return {
        insert(row) {
          inserts.push({ table, row })
          return { select: () => ({ single: async () => (error ? { data: null, error } : { data: { id: 'lead-1' }, error: null }) }) }
        },
      }
    },
  })
}

test('/advertise and the /partner alias route to the Advertise screen on the site shell', () => {
  assert.equal(routeFor('/advertise').path, 'advertise')
  assert.equal(routeFor('/partner').path, 'advertise')
  assert.equal(routeFor('/partners').path, 'partners', 'rental partner portal is untouched')
  const app = read('src/App.jsx')
  const siteRoutes = app.slice(app.indexOf('const SITE_ROUTES'), app.indexOf('function Screen'))
  assert.match(siteRoutes, /'advertise'/)
  assert.match(siteRoutes, /'partner'/)
  assert.match(app, /case 'advertise':\s*case 'partner':[\s\S]{0,160}return <Advertise \/>/)
  const chrome = read('src/components/MarketingChrome.jsx')
  assert.match(chrome, /\{ id: 'advertise', label: 'Advertise with us' \}/)
  assert.match(chrome, /ids: \['why-clemson-rides', 'safety', 'drive', 'advertise'\]/)
})

test('page renders the QR-first, pay-per-ride pitch, draft ride bundles and the interest form', async () => {
  const html = await renderScreen('Advertise')
  assert.match(html, /Advertise with us/)
  assert.match(html, /back of the front seat/)
  assert.match(html, /game-day specials/)
  assert.match(html, /<h1[^>]*>Riders scan your deal\. You see every scan\.<\/h1>/)
  assert.match(html, /pay only for the rides your ad is shown in/i)
  for (const [rides, price] of [['100 rides', '\\$12'], ['250 rides', '\\$25'], ['1,000 rides', '\\$89'], ['5,000 rides', '\\$299']]) {
    assert.match(html, new RegExp(`<h3>${rides}</h3><p class="adv-price">${price}</p>`))
  }
  assert.match(html, /Game-day weekend boost/)
  assert.match(html, /Draft launch pricing, pending approval/)
  assert.match(html, /every ride your ad ran on, with timestamp and QR scans/i)
  assert.doesNotMatch(html, /\b\d[\d,]* (cars|drivers|rides (a|per) (week|month|day))\b/i, 'no fleet size or ride volume claims')
  assert.doesNotMatch(html, /data-testid="adv-(samples|hero-demo|how-video)"/, 'media slots stay empty until John approves the assets')
  for (const name of ['businessName', 'contactName', 'email', 'phone', 'category', 'tier', 'message', AD_LEAD_HONEYPOT]) {
    assert.match(html, new RegExp(`name="${name}"`))
  }
  assert.doesNotMatch(html, /PLACEHOLDER/, 'placeholder tiers never render while the flag is off')
  assert.equal(BANNED.test(html), false)
  assert.equal(BANNED.test(read('src/screens/Advertise.jsx')), false)
  assert.match(read('src/styles/advertise.css'), /#F56600/)
  assert.match(read('src/styles/advertise.css'), /#522D80/)
})

test('pricing config: draft ride bundles, per-ride rates, and billing still pending approval', () => {
  assert.equal(ADS_PACKAGES_APPROVED, false)
  assert.deepEqual(RIDE_BUNDLES.map((b) => [b.rides, b.priceCents]), [[100, 1200], [250, 2500], [1000, 8900], [5000, 29900]])
  assert.deepEqual(RIDE_BUNDLES.map(perRideCents), [12, 10, 8.9, 5.98])
  assert.equal(formatPerRide(RIDE_BUNDLES[2]), '8.9¢ per ride')
  assert.deepEqual(publicAdPackages().map((b) => b.id), ['rides-100', 'rides-250', 'rides-1000', 'rides-5000'])
  assert.deepEqual(tierChoices().map((t) => t.id), ['founding-partner', 'rides-100', 'rides-250', 'rides-1000', 'rides-5000', 'not-sure'])
  const rows = bundlePackageRows()
  assert.ok(rows.every((r) => r.placeholder === true && r.active === false), 'draft rows stay out of billing until approved')
  assert.ok(rows.filter((r) => r.kind === 'bundle').every((r) => r.rides_included > 0 && r.price_cents > 0))
  assert.ok(bundlePackageRows(true).filter((r) => r.kind === 'bundle').every((r) => r.active && !r.placeholder))
  assert.match(PRICING_STATUS_COPY, /pending approval/)
})

test('form validation flags each required field and accepts a good lead', () => {
  const errors = adLeadErrors({})
  assert.deepEqual(Object.keys(errors).sort(), ['businessName', 'category', 'contactName', 'email', 'phone'])
  assert.ok(adLeadErrors({ ...GOOD, email: 'nope' }).email)
  assert.ok(adLeadErrors({ ...GOOD, phone: '555' }).phone)
  assert.deepEqual(adLeadErrors(GOOD), {})
  assert.equal(isAdLeadBot({ [AD_LEAD_HONEYPOT]: 'http://spam' }), true)
  assert.equal(isAdLeadBot(GOOD), false)
  const row = adLeadRow({ ...GOOD, email: ' PAT@Example.Test ' })
  assert.equal(row.email, 'pat@example.test')
  assert.equal(row.source, 'advertise_page')
  assert.equal(row.interested_tier, 'founding-partner')
})

test('insert path: a valid lead is stored in ad_partner_leads and the admin is notified', async () => {
  const inserts = []
  const sent = []
  const handler = createAdLeadsHandler({
    db: fakeDb(inserts), recipients: () => ['admin@example.test'], limit: () => true,
    send: async (m) => { sent.push(m); return { emailed: true } },
  })
  const res = fakeRes()
  await handler({ method: 'POST', headers: { 'user-agent': 'node-test' }, body: JSON.stringify(GOOD) }, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(res.json, { ok: true, id: 'lead-1', notified: true })
  assert.equal(inserts.length, 1)
  assert.equal(inserts[0].table, 'ad_partner_leads')
  assert.equal(inserts[0].row.business_name, 'TEST Tiger Tacos')
  assert.equal(inserts[0].row.user_agent, 'node-test')
  assert.equal(sent[0].to, 'admin@example.test')
  assert.match(sent[0].subject, /New advertising lead: TEST Tiger Tacos/)
})

test('insert path: honeypot, validation, rate limit, GET and db errors never store a lead', async () => {
  const inserts = []
  let allow = true
  const handler = createAdLeadsHandler({ db: fakeDb(inserts), recipients: () => [], limit: () => allow, send: async () => ({}) })
  const call = async (req) => { const res = fakeRes(); await handler({ headers: {}, ...req }, res); return res }

  const bot = await call({ method: 'POST', body: { ...GOOD, [AD_LEAD_HONEYPOT]: 'x' } })
  assert.equal(bot.statusCode, 200)
  const bad = await call({ method: 'POST', body: { ...GOOD, email: 'x' } })
  assert.equal(bad.statusCode, 400)
  assert.ok(bad.json.errors.email)
  assert.equal((await call({ method: 'GET' })).statusCode, 405)
  allow = false
  assert.equal((await call({ method: 'POST', body: GOOD })).statusCode, 429)
  assert.equal(inserts.length, 0)

  const failing = createAdLeadsHandler({ db: fakeDb([], { error: { message: 'boom' } }), recipients: () => [], limit: () => true })
  const res = fakeRes()
  await failing({ method: 'POST', headers: {}, body: GOOD }, res)
  assert.equal(res.statusCode, 500)
  assert.doesNotMatch(res.body, /boom/)
})

test('default rate limit allows 5 leads per IP per 10 minutes', async () => {
  const { resetRateLimits } = await import('../server/agentHttp.js')
  resetRateLimits()
  const handler = createAdLeadsHandler({ db: fakeDb([]), recipients: () => [] })
  const codes = []
  for (let i = 0; i < 6; i += 1) {
    const res = fakeRes()
    await handler({ method: 'POST', headers: { 'x-forwarded-for': '203.0.113.9' }, body: GOOD }, res)
    codes.push(res.statusCode)
  }
  assert.deepEqual(codes, [200, 200, 200, 200, 200, 429])
  resetRateLimits()
})

test('client submit posts JSON to /api/ad-leads and surfaces field errors', async () => {
  const built = await esbuild.build({
    absWorkingDir: fileURLToPath(root), entryPoints: ['src/screens/Advertise.jsx'], bundle: true, format: 'esm',
    platform: 'node', jsx: 'automatic', write: false, loader: { '.css': 'empty' },
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', 'qrcode'],
  })
  const dir = mkdtempSync(join(fileURLToPath(root), '.advertise-client-'))
  try {
    const file = join(dir, 'a.mjs')
    writeFileSync(file, built.outputFiles[0].text)
    const { submitAdLead } = await import(pathToFileURL(file).href)
    const calls = []
    const ok = await submitAdLead(GOOD, async (url, init) => { calls.push([url, init]); return { ok: true, json: async () => ({ ok: true }) } })
    assert.deepEqual(ok, { ok: true })
    assert.equal(calls[0][0], '/api/ad-leads')
    assert.equal(calls[0][1].method, 'POST')
    assert.equal(JSON.parse(calls[0][1].body).businessName, GOOD.businessName)
    await assert.rejects(
      submitAdLead(GOOD, async () => ({ ok: false, json: async () => ({ error: 'Fix the highlighted fields.', errors: { email: 'x' } }) })),
      (err) => err.message === 'Fix the highlighted fields.' && err.errors.email === 'x',
    )
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('migration: anonymous insert only, admins read, nobody else selects', async () => {
  const ADMIN = 'aaaaaaaa-0000-4000-8000-000000000001'
  const USER = 'bbbbbbbb-0000-4000-8000-000000000001'
  const db = new PGlite()
  await db.exec(`
    create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    grant usage on schema auth to authenticated, anon;
    grant usage on schema public to anon, authenticated, service_role;
    create table public.profiles (id uuid primary key, is_admin boolean default false);
    create function public.is_admin() returns boolean language sql stable security definer as $$
      select coalesce((select is_admin from public.profiles where id = auth.uid()), false) $$;
    insert into public.profiles values ('${ADMIN}', true), ('${USER}', false);
  `)
  const migration = read('supabase/migrations/20261016190000_ad_partner_leads.sql')
  await db.exec(migration)
  await db.exec(migration) // idempotent
  const insert = `insert into public.ad_partner_leads (business_name, contact_name, email, phone, category) values ('TEST Biz', 'Pat', 'p@x.co', '8645550100', 'Other')`
  await db.exec(`set role anon; ${insert}; reset role;`)
  await assert.rejects(db.exec(`set role anon; select * from public.ad_partner_leads;`))
  await db.exec('reset role')
  await assert.rejects(db.exec(`set role anon; insert into public.ad_partner_leads (business_name, contact_name, email, phone, category, status) values ('TEST Biz', 'Pat', 'p@x.co', '8645550100', 'Other', 'won');`))
  await db.exec('reset role')
  await db.exec(`set role authenticated; select set_config('test.uid', '${USER}', false);`)
  assert.equal((await db.query('select id from public.ad_partner_leads')).rows.length, 0)
  await db.exec(`select set_config('test.uid', '${ADMIN}', false);`)
  assert.equal((await db.query('select id from public.ad_partner_leads')).rows.length, 1)
  await db.exec(`reset role;`)
  assert.equal(BANNED.test(migration), false)
})
