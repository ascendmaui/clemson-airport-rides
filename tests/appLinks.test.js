import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  AASA_PATH,
  ANDROID_SHA256_FINGERPRINT_PLACEHOLDER,
  ANDROID_SHA256_FINGERPRINTS,
  APPLE_TEAM_ID,
  ASSETLINKS_PATH,
  BOOK_RIDE_PATH,
  DRIVER_BUNDLE_ID,
  DRIVER_LINK_PATHS,
  RIDER_BUNDLE_ID,
  RIDER_LINK_PATHS,
  androidIntentData,
  appId,
  appleAppSiteAssociation,
  assetLinksDocument,
  assetLinksEnabled,
} from '../shared/appLinks.js'
import { bookRideHref, isIosUserAgent } from '../src/lib/bookRideLink.js'
import { applyRewrites, createApp, loadRewrites } from '../server/selfHost.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8')
}

function httpRequest(port, reqPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: reqPath, method: 'GET' }, (res) => {
      const chunks = []
      res.on('data', (chunk) => chunks.push(chunk))
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          headers: res.headers,
          text: Buffer.concat(chunks).toString('utf8'),
        })
      })
    })
    req.on('error', reject)
    req.end()
  })
}

test('apple-app-site-association names the team, the apps, and the routes they open', () => {
  const served = JSON.parse(read('public/.well-known/apple-app-site-association'))
  const expected = appleAppSiteAssociation()
  assert.deepEqual(served, expected)
  assert.equal(APPLE_TEAM_ID, 'L85AF3V872')
  assert.equal(appId(RIDER_BUNDLE_ID), 'L85AF3V872.com.ascendmaui.clemsonrides.rider')
  assert.equal(appId(DRIVER_BUNDLE_ID), 'L85AF3V872.com.ascendmaui.clemsonrides.driver')
  assert.deepEqual(served.applinks.details[0].paths, RIDER_LINK_PATHS.map((entry) => entry.apple))
  assert.deepEqual(served.applinks.details[1].paths, DRIVER_LINK_PATHS.map((entry) => entry.apple))
  assert.ok(served.applinks.details[0].paths.includes(BOOK_RIDE_PATH))
  assert.ok(served.applinks.details[0].paths.includes('/auth/callback'))
  assert.ok(served.applinks.details[1].paths.includes('/driver/*'))
  for (const entry of [...RIDER_LINK_PATHS, ...DRIVER_LINK_PATHS]) {
    assert.equal(existsSync(path.join(root, entry.route)), true, entry.route)
  }
  assert.equal(existsSync(path.join(root, 'public/.well-known/assetlinks.json')), false)
})

test('Android intent filters claim the same paths, and assetlinks stays off', () => {
  const rider = JSON.parse(read('apps/rider/app.json'))
  const driver = JSON.parse(read('apps/driver/app.json'))
  assert.deepEqual(rider.expo.android.intentFilters[0].data, androidIntentData(RIDER_LINK_PATHS))
  assert.deepEqual(driver.expo.android.intentFilters[0].data, androidIntentData(DRIVER_LINK_PATHS))
  assert.equal(rider.expo.android.intentFilters[0].autoVerify, true)
  assert.equal(driver.expo.android.intentFilters[0].autoVerify, true)
  for (const app of [rider, driver]) {
    assert.deepEqual(app.expo.ios.associatedDomains, [
      'applinks:clemsonrides.com',
      'applinks:www.clemsonrides.com',
    ])
  }
  assert.equal(assetLinksEnabled(), false)
  assert.equal(assetLinksDocument(), null)
  assert.ok(ANDROID_SHA256_FINGERPRINTS.rider.includes(ANDROID_SHA256_FINGERPRINT_PLACEHOLDER))
  assert.ok(ANDROID_SHA256_FINGERPRINTS.driver.includes(ANDROID_SHA256_FINGERPRINT_PLACEHOLDER))
  const fingerprint = 'AB:'.repeat(32).slice(0, -1)
  const ready = { rider: [fingerprint], driver: [fingerprint] }
  assert.equal(assetLinksEnabled(ready), true)
  const document = assetLinksDocument(ready)
  assert.deepEqual(document.map((row) => row.target.package_name), [RIDER_BUNDLE_ID, DRIVER_BUNDLE_ID])
  assert.equal(assetLinksEnabled({ rider: [fingerprint], driver: [ANDROID_SHA256_FINGERPRINT_PLACEHOLDER] }), false)
})

test('the association file is JSON with no redirect, and Book a ride is a universal link', () => {
  const vercel = JSON.parse(read('vercel.json'))
  assert.equal(vercel.redirects, undefined)
  const header = vercel.headers.find((item) => item.source === AASA_PATH)
  assert.equal(header.headers.find((item) => item.key === 'Content-Type').value, 'application/json')
  const rules = loadRewrites(path.join(root, 'vercel.json'))
  assert.equal(applyRewrites(AASA_PATH, '', rules).matched, false)
  assert.equal(applyRewrites(ASSETLINKS_PATH, '', rules).matched, false)
  assert.equal(applyRewrites('/book', '', rules).pathname, '/index.html')
  const compose = read('deploy/docker-compose.yml')
  assert.match(compose, /clemson-www-aasa\.rule=Host\(`www\.clemsonrides\.com`\) && Path\(`\/\.well-known\/apple-app-site-association`\)/)
  assert.match(compose, /clemson-www-aasa-next\.rule=Host\(`www\.clemsonrides\.com`\) && Path\(`\/\.well-known\/apple-app-site-association`\)/)
  assert.doesNotMatch(compose, /clemson-www-aasa\.middlewares/)
  assert.doesNotMatch(compose, /clemson-www-aasa-next\.middlewares/)
  const wellKnown = readdirSync(path.join(root, 'public/.well-known'))
  assert.deepEqual(wellKnown, ['apple-app-site-association'])

  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'
  assert.equal(isIosUserAgent(iphone), true)
  assert.equal(bookRideHref({ hostname: 'clemsonrides.com', origin: 'https://clemsonrides.com', userAgent: iphone }), 'https://www.clemsonrides.com/book')
  assert.equal(bookRideHref({ hostname: 'www.clemsonrides.com', origin: 'https://www.clemsonrides.com', userAgent: iphone }), 'https://clemsonrides.com/book')
  assert.equal(bookRideHref({ hostname: 'clemsonrides.com', origin: 'https://clemsonrides.com', userAgent: 'Mozilla/5.0' }), 'https://clemsonrides.com/book')
  assert.equal(bookRideHref({ hostname: 'preview.vercel.app', origin: 'https://preview.vercel.app', userAgent: iphone }), 'https://preview.vercel.app/book')

  for (const file of [
    'src/screens/Marketing.jsx',
    'src/screens/WhyClemsonRides.jsx',
    'src/screens/MarketingInfo.jsx',
    'src/screens/ServiceArea.jsx',
    'src/screens/FriendsAccount.jsx',
  ]) {
    const source = read(file)
    assert.match(source, /Book a ride/, file)
    assert.match(source, /bookRideHref\(\)/, file)
  }
  assert.match(read('src/screens/Marketing.jsx'), /mkt-book/)
  assert.match(read('src/screens/Marketing.jsx'), /href=\{bookRideHref\(\)\}/)
})

test('the site serves the association file as JSON and does not serve a placeholder assetlinks file', async () => {
  const distDir = await mkdtemp(path.join(tmpdir(), 'clemson-aasa-'))
  const listener = await createApp({
    distDir,
    apiDir: path.join(root, 'api'),
    vercelPath: path.join(root, 'vercel.json'),
    log() {},
  })
  const server = http.createServer(listener)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    await mkdir(path.join(distDir, '.well-known'), { recursive: true })
    await writeFile(path.join(distDir, 'index.html'), '<!doctype html><title>Clemson Rides</title>')
    await writeFile(
      path.join(distDir, '.well-known', 'apple-app-site-association'),
      read('public/.well-known/apple-app-site-association'),
    )
    const aasa = await httpRequest(port, AASA_PATH)
    assert.equal(aasa.status, 200)
    assert.match(String(aasa.headers['content-type']), /^application\/json/)
    assert.equal(aasa.headers.location, undefined)
    assert.deepEqual(JSON.parse(aasa.text), appleAppSiteAssociation())

    const assetlinks = await httpRequest(port, ASSETLINKS_PATH)
    assert.equal(assetlinks.status, 404)
    assert.match(String(assetlinks.headers['content-type']), /json/)
    assert.doesNotMatch(assetlinks.text, /REPLACE_WITH_SHA256/)
    assert.doesNotMatch(assetlinks.text, /<html/)

    const book = await httpRequest(port, '/book')
    assert.equal(book.status, 200)
    assert.match(String(book.headers['content-type']), /text\/html/)
    assert.match(book.text, /Clemson Rides/)
  } finally {
    server.closeAllConnections?.()
    await new Promise((resolve) => server.close(resolve))
    await rm(distDir, { recursive: true, force: true })
  }
})
