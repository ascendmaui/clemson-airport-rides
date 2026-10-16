import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import esbuild from 'esbuild'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { getHashRoute } from '../src/lib/navigation.js'
import { DEMO_FEED, QUEUE_KEY, flushImpressions, impressionFor, queueImpression, rememberDeviceToken } from '../src/lib/tabletPlayer.js'

const root = new URL('..', import.meta.url)
const read = (p) => readFileSync(new URL(p, root), 'utf8')
const BANNED = new RegExp(['te' + 'sla', 'self' + '-driving', 'robo' + 'taxi', 'andr' + 'oid', 'play ' + 'store', 'google ' + 'play'].join('|'), 'i')

function memoryStorage() {
  const m = new Map()
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }
}

function routeFor(pathname, search = '') {
  const prev = globalThis.window
  globalThis.window = { location: { hash: '', pathname, search, origin: 'https://clemsonrides.com', replace() {} }, sessionStorage: { getItem() { return null }, setItem() {} } }
  try { return getHashRoute() } finally {
    if (prev === undefined) delete globalThis.window
    else globalThis.window = prev
  }
}

async function render(entry, exportName, props = {}) {
  const built = await esbuild.build({
    absWorkingDir: fileURLToPath(root), entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', jsx: 'automatic', write: false,
    loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' },
    external: ['react', 'react-dom', 'react/jsx-runtime', 'react/jsx-dev-runtime', '@supabase/supabase-js', 'qrcode'],
  })
  const dir = mkdtempSync(join(fileURLToPath(root), '.ads-render-'))
  try {
    const file = join(dir, 'm.mjs')
    writeFileSync(file, built.outputFiles[0].text)
    const mod = await import(pathToFileURL(file).href)
    return renderToStaticMarkup(createElement(mod[exportName], props))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('routes: /advertise/signup, /advertise/my and /tablet are wired', () => {
  assert.deepEqual([routeFor('/advertise/signup').path, routeFor('/advertise/signup').params.sub], ['advertise', 'signup'])
  assert.equal(routeFor('/advertise/my').params.sub, 'my')
  const tablet = routeFor('/tablet', '?device=crt_abc')
  assert.equal(tablet.path, 'tablet')
  assert.equal(tablet.params.device, 'crt_abc')
  const app = read('src/App.jsx')
  assert.match(app, /if \(params\.sub === 'signup' \|\| params\.sub === 'my'\) return <AdsSignup sub=\{params\.sub\} \/>/)
  assert.match(app, /case 'tablet':\s*return <TabletPlayer params=\{params\} \/>/)
  const siteRoutes = app.slice(app.indexOf('const SITE_ROUTES'), app.indexOf('function Screen'))
  assert.doesNotMatch(siteRoutes, /'tablet'/, 'the kiosk has no marketing chrome')
  const desk = read('src/screens/AdminDesk.jsx')
  assert.match(desk, /\['ads', 'Tablet ads'\]/)
  assert.match(desk, /tab === 'ads' && <AdsAdminPanel \/>/)
  assert.match(read('src/screens/Advertise.jsx'), /href="\/advertise\/signup"/)
})

test('tablet demo renders the TEST creative full screen with the deal QR', async () => {
  const html = await render('src/screens/TabletPlayer.jsx', 'TabletPlayer', { params: { demo: '1' } })
  assert.match(html, /class="tablet"/)
  assert.match(html, /TEST Tiger Tacos/)
  assert.match(html, /TEST demo/)
  assert.match(html, /mkt-qr-svg/)
  assert.match(html, /Clemson Rides/)
  assert.equal(BANNED.test(html), false)
  const css = read('src/styles/ads.css')
  assert.match(css, /#F56600/)
  assert.match(css, /#522D80/)
  assert.match(css, /position: fixed; inset: 0/)
})

test('unpaired tablet explains how to pair', async () => {
  const prev = globalThis.window
  globalThis.window = { localStorage: memoryStorage() }
  try {
    const html = await render('src/screens/TabletPlayer.jsx', 'TabletPlayer', { params: {} })
    assert.match(html, /not paired yet/)
  } finally {
    if (prev === undefined) delete globalThis.window
    else globalThis.window = prev
  }
})

test('sign-up form renders package, upload or build choice and a live preview', async () => {
  const html = await render('src/screens/AdsSignup.jsx', 'AdsSignupForm', { api: { fetchAdPackages: async () => ({ packages: [] }), submitAdSignup: async () => ({}), uploadAdCreative: async () => ({}) } })
  for (const name of ['businessName', 'contactName', 'email', 'phone', 'packageId', 'headline', 'dealText', 'qrUrl', 'website2']) assert.match(html, new RegExp(`name="${name}"`))
  assert.match(html, /Build my ad/)
  assert.match(html, /Upload my own/)
  assert.match(html, /Founding partner \(rates on request\)/)
  assert.match(html, /data-testid="adc-built"/)
  assert.equal(BANNED.test(html), false)
})

test('impression queue survives offline and flushes once online', async () => {
  const s = memoryStorage()
  const slot = DEMO_FEED.loop[0]
  queueImpression(impressionFor(slot, { startedAt: Date.now() - 8000, inTrip: true }), s)
  queueImpression(impressionFor(slot, { startedAt: Date.now() - 4000 }), s)
  const offline = await flushImpressions(async () => { throw new Error('offline') }, s)
  assert.equal(offline.sent, 0)
  assert.equal(JSON.parse(s.getItem(QUEUE_KEY)).length, 2)
  const got = []
  const online = await flushImpressions(async (batch) => { got.push(...batch) }, s)
  assert.equal(online.sent, 2)
  assert.equal(JSON.parse(s.getItem(QUEUE_KEY)).length, 0)
  assert.equal(got[0].inTrip, true)
  assert.ok(got[0].seconds >= 7.9)
  assert.equal(rememberDeviceToken('crt_x', s), 'crt_x')
  assert.equal(rememberDeviceToken('', s), 'crt_x', 'token persists across reloads')
})

test('ads sources keep the product locks', () => {
  for (const p of ['src/screens/TabletPlayer.jsx', 'src/screens/AdsSignup.jsx', 'src/components/AdsAdminPanel.jsx', 'src/components/AdCreative.jsx', 'api/ads.js', 'server/ads/service.js', 'server/ads/billing.js', 'server/ads/automation.js', 'scripts/ads/sync-stripe-packages.mjs', 'docs/ads-system.md']) {
    assert.equal(BANNED.test(read(p)), false, p)
  }
})
