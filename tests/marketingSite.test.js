import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { MARKETING_FEATURES } from '../shared/marketingFeatures.js'
import {
  ANDROID_STORE_URL,
  APP_DOWNLOADS,
  DRIVER_EXPO_PROJECT,
  IOS_STORE_URL,
  RIDER_EXPO_PROJECT,
} from '../shared/productLinks.js'
import { qrMatrix } from '../src/lib/qrMatrix.js'

test('store listings stay unpublished until real URLs exist', () => {
  assert.equal(IOS_STORE_URL, null)
  assert.equal(ANDROID_STORE_URL, null)
  assert.equal(APP_DOWNLOADS.length, 2)
  assert.equal(APP_DOWNLOADS[0].href, RIDER_EXPO_PROJECT)
  assert.equal(APP_DOWNLOADS[1].href, DRIVER_EXPO_PROJECT)
  for (const app of APP_DOWNLOADS) {
    assert.equal(app.iosHref, app.href)
    assert.equal(app.androidHref, app.href)
    assert.match(app.iosNote, /Expo project/)
    assert.match(app.androidNote, /Expo project/)
    assert.doesNotMatch(`${app.href} ${app.iosHref} ${app.androidHref}`, /apps\.apple\.com|play\.google\.com/)
  }
})

test('marketing features match the shipped product', () => {
  assert.deepEqual(MARKETING_FEATURES.map((feature) => feature.title), [
    'Airport rides',
    'Student discount',
    'Game day',
    'Weekend and party',
    'Tesla Model 3',
    'Preferred drivers',
    'Schedule',
  ])
  const tesla = MARKETING_FEATURES.find((feature) => feature.id === 'tesla')
  assert.match(tesla.body, /driver is at the wheel/i)
  assert.match(tesla.body, /no self-driving/i)
  const student = MARKETING_FEATURES.find((feature) => feature.id === 'student')
  assert.match(student.body, /10% off Standard/)
  assert.match(student.body, /confirmed/)
  assert.match(student.body, /@clemson\.edu/)
  assert.match(student.body, /@g\.clemson\.edu/)
  assert.match(student.body, /Comfort/)
  assert.match(student.body, /\bXL\b/)
  assert.match(student.body, /Pet/)
  assert.match(student.body, /Tesla/)
  assert.match(student.body, /not included/)
  assert.doesNotMatch(student.body, /student flag/i)
  const preferred = MARKETING_FEATURES.find((feature) => feature.id === 'preferred')
  assert.match(preferred.body, /decline/i)
})

test('the marketing page wires downloads and does not invent store ids', () => {
  const source = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  assert.match(source, /Get the app/)
  assert.match(source, /Book a ride/)
  assert.match(source, /RIDER_EXPO_PROJECT/)
  assert.match(source, /DRIVER_EXPO_PROJECT/)
  assert.match(source, /MARKETING_FEATURES/)
  assert.doesNotMatch(source, /apps\.apple\.com|play\.google\.com/)
  assert.doesNotMatch(source, /ae9bb5b6|a9cfec15/)
  assert.doesNotMatch(source, /projects\/clemson-airport-rides\/builds/)
})

test('download QR codes are square modules for the public install links', () => {
  for (const href of [RIDER_EXPO_PROJECT, DRIVER_EXPO_PROJECT]) {
    const matrix = qrMatrix(href)
    assert.ok(matrix.size >= 21)
    assert.equal(matrix.size % 1, 0)
    assert.equal(matrix.cells.some(([x, y]) => x === 0 && y === 0), true)
    assert.equal(matrix.cells.every(([x, y]) => x < matrix.size && y < matrix.size), true)
  }
})

test('marketing route links and anchors match App router definitions', () => {
  const mktSource = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  const appSource = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8')

  // Section anchor target
  assert.match(mktSource, /id="get-the-app"/)
  assert.match(mktSource, /getElementById\('get-the-app'\)/)

  // Navigation targets from Marketing.jsx
  const navTargets = [...mktSource.matchAll(/navigate\('([^']+)'/g)].map((m) => m[1])
  const uniqueTargets = [...new Set(navTargets)]

  // Verify all targets are handled in App.jsx Screen switch statement
  for (const target of uniqueTargets) {
    const routeRegex = new RegExp(`case\\s+'${target}':`)
    assert.match(appSource, routeRegex, `Route target '${target}' from Marketing.jsx missing in App.jsx router`)
  }

  // Verify SITE_ROUTES includes marketing public paths
  assert.match(appSource, /SITE_ROUTES\s*=\s*new Set\(\['landing',\s*'',\s*'privacy',\s*'terms'\]\)/)
})

test('download card shared-code branch and fallback logic', () => {
  const mktSource = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')

  // Confirms the single vs dual QR code logic based on store URL presence
  assert.match(mktSource, /const sharedCode = app\.iosHref === app\.androidHref/)
  assert.match(mktSource, /One code for this app\. iOS and Android both open the current Expo project\./)
  assert.match(mktSource, /Separate codes for the iOS and Android listings\./)

  // Simulate download mapping with current null store URLs
  const currentDownloads = APP_DOWNLOADS.map((app) => {
    const expo = app.id === 'driver' ? DRIVER_EXPO_PROJECT : RIDER_EXPO_PROJECT
    return {
      ...app,
      href: expo,
      iosHref: IOS_STORE_URL || expo,
      androidHref: ANDROID_STORE_URL || expo,
    }
  })

  for (const d of currentDownloads) {
    assert.equal(d.iosHref, d.androidHref)
    assert.ok(d.href.startsWith('https://expo.dev/'))
  }

  // Simulate hypothetical published store URLs
  const hypothetical = APP_DOWNLOADS.map((app) => {
    const expo = app.id === 'driver' ? DRIVER_EXPO_PROJECT : RIDER_EXPO_PROJECT
    return {
      ...app,
      href: expo,
      iosHref: 'https://apps.apple.com/app/id123',
      androidHref: 'https://play.google.com/store/apps/details?id=com.clemson',
    }
  })
  for (const d of hypothetical) {
    assert.notEqual(d.iosHref, d.androidHref)
  }
})

test('QrMark component structure, quiet zone, and Clemson theme colors', () => {
  const qrMarkSource = readFileSync(new URL('../src/components/QrMark.jsx', import.meta.url), 'utf8')

  // Quiet zone must be 2 modules
  assert.match(qrMarkSource, /const quiet = 2/)
  assert.match(qrMarkSource, /const span = matrix\.size \+ quiet \* 2/)

  // SVG accessibility role and label
  assert.match(qrMarkSource, /role="img"/)
  assert.match(qrMarkSource, /aria-label=\{`\$\{label\} download QR`\}/)

  // Background white and data cells Clemson Regalia purple #522D80
  assert.match(qrMarkSource, /fill="#ffffff"/)
  assert.match(qrMarkSource, /fill="#522D80"/)
})

test('qrMatrix input behavior with empty text and valid URLs', () => {
  assert.throws(() => qrMatrix(''), /No input text/)
  assert.throws(() => qrMatrix([]), /No input text/)

  const riderMatrix = qrMatrix(RIDER_EXPO_PROJECT)
  assert.ok(riderMatrix.size >= 21)
  assert.ok(riderMatrix.cells.length > 0)

  const driverMatrix = qrMatrix(DRIVER_EXPO_PROJECT)
  assert.ok(driverMatrix.size >= 21)
  assert.ok(driverMatrix.cells.length > 0)
})

