import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { MARKETING_FEATURES } from '../shared/marketingFeatures.js'
import {
  ANDROID_STORE_URL,
  APP_DOWNLOADS,
  DRIVER_ANDROID_STORE_URL,
  DRIVER_IOS_STORE_URL,
  IOS_STORE_URL,
  RIDER_ANDROID_STORE_URL,
  RIDER_IOS_STORE_URL,
  WEB_BOOK_URL,
  WEB_DRIVER_URL,
  WEB_ORIGIN,
  WEB_SCHEDULE_URL,
  publishedStoreUrl,
} from '../shared/productLinks.js'
import { qrMatrix } from '../src/lib/qrMatrix.js'

const EXPO_LINK = /expo\.dev|expo\.go|exp:\/\/|Expo Go/i

test('store listings stay unpublished until real URLs exist', () => {
  assert.equal(IOS_STORE_URL, null)
  assert.equal(ANDROID_STORE_URL, null)
  assert.equal(RIDER_IOS_STORE_URL, null)
  assert.equal(RIDER_ANDROID_STORE_URL, null)
  assert.equal(DRIVER_IOS_STORE_URL, null)
  assert.equal(DRIVER_ANDROID_STORE_URL, null)
  assert.equal(publishedStoreUrl('https://expo.dev/accounts/johnmatveyev/projects/clemson-rides-rider'), null)
  assert.equal(publishedStoreUrl('exp://127.0.0.1:8081'), null)
  assert.equal(publishedStoreUrl('https://expo.go'), null)
  assert.equal(APP_DOWNLOADS.length, 2)
  assert.equal(APP_DOWNLOADS[0].id, 'rider')
  assert.equal(APP_DOWNLOADS[0].href, 'https://clemsonrides.com/#/home')
  assert.equal(APP_DOWNLOADS[0].iosHref, 'https://clemsonrides.com/#/home')
  assert.equal(APP_DOWNLOADS[0].androidHref, 'https://clemsonrides.com/#/home')
  assert.equal(APP_DOWNLOADS[0].href, WEB_BOOK_URL)
  assert.equal(APP_DOWNLOADS[1].id, 'driver')
  assert.equal(APP_DOWNLOADS[1].href, 'https://clemsonrides.com/#/driver')
  assert.equal(APP_DOWNLOADS[1].iosHref, 'https://clemsonrides.com/#/driver')
  assert.equal(APP_DOWNLOADS[1].androidHref, 'https://clemsonrides.com/#/driver')
  assert.equal(APP_DOWNLOADS[1].href, WEB_DRIVER_URL)
  for (const app of APP_DOWNLOADS) {
    assert.match(app.iosNote, /not live yet/)
    assert.match(app.androidNote, /not live yet/)
    assert.match(app.blurb, /not live yet/)
    const targets = `${app.href} ${app.iosHref} ${app.androidHref} ${app.iosNote} ${app.androidNote} ${app.blurb}`
    assert.doesNotMatch(targets, EXPO_LINK)
    assert.doesNotMatch(targets, /apps\.apple\.com|play\.google\.com|testflight/)
    assert.match(app.href, /^https:\/\/clemsonrides\.com\//)
  }
})

test('marketing features match the shipped product', () => {
  assert.deepEqual(MARKETING_FEATURES.map((feature) => feature.title), [
    'Airport rides',
    'Student discount',
    'Game day',
    'Weekend and party',
    'Preferred drivers',
    'Schedule',
    'Real-time matching',
    'Live trip tracking',
  ])
  const airport = MARKETING_FEATURES.find((feature) => feature.id === 'airport')
  assert.match(airport.body, /pre-authorization hold/)
  assert.match(airport.body, /full fare is charged when the trip ends/)
  assert.doesNotMatch(airport.body, /25% deposit/)
  const student = MARKETING_FEATURES.find((feature) => feature.id === 'student')
  assert.match(student.body, /10% off Standard/)
  assert.match(student.body, /confirmed/)
  assert.match(student.body, /@clemson\.edu/)
  assert.match(student.body, /@g\.clemson\.edu/)
  assert.match(student.body, /Other ride types/)
  assert.match(student.body, /not included/)
  assert.doesNotMatch(student.body, /student flag/i)
  const preferred = MARKETING_FEATURES.find((feature) => feature.id === 'preferred')
  assert.match(preferred.body, /decline/i)
})

test('the marketing page wires downloads and does not invent store ids', () => {
  const source = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  assert.match(source, /Get the app/)
  assert.match(source, /Book a ride/)
  assert.match(source, /WEB_BOOK_URL/)
  assert.match(source, /WEB_DRIVER_URL/)
  assert.match(source, /APP_DOWNLOADS/)
  assert.doesNotMatch(source, /const DOWNLOADS/)
  assert.match(source, /not live yet/)
  assert.match(source, /MARKETING_FEATURES/)
  assert.doesNotMatch(source, EXPO_LINK)
  assert.doesNotMatch(source, /RIDER_EXPO_PROJECT|DRIVER_EXPO_PROJECT/)
  assert.doesNotMatch(source, /apps\.apple\.com|play\.google\.com/)
  assert.doesNotMatch(source, /ae9bb5b6|a9cfec15/)
  assert.doesNotMatch(source, /projects\/clemson-airport-rides\/builds/)
  assert.match(source, /STANDING_OFFERS/)
  assert.match(source, /currentWeeklyCoupon/)
  assert.match(source, /Standard, Wait & Save, Extra Comfort/)
  assert.match(source, /pre-authorization hold/)
  assert.doesNotMatch(source, /25% deposit/)
  const retiredFleet = new RegExp(['te' + 'sla', 'model' + ' 3', 'robo' + 'taxi', 'self' + '-driving'].join('|'), 'i')
  assert.equal(retiredFleet.test(source), false)
})

test('download QR codes are square modules for the public install links', () => {
  for (const href of [WEB_BOOK_URL, WEB_DRIVER_URL]) {
    const matrix = qrMatrix(href)
    assert.ok(matrix.size >= 21)
    assert.equal(matrix.size % 1, 0)
    assert.equal(matrix.cells.some(([x, y]) => x === 0 && y === 0), true)
    assert.equal(matrix.cells.every(([x, y]) => x < matrix.size && y < matrix.size), true)
  }
  const rider = APP_DOWNLOADS.find((app) => app.id === 'rider')
  const driver = APP_DOWNLOADS.find((app) => app.id === 'driver')
  assert.deepEqual(qrMatrix(rider.href), qrMatrix(WEB_BOOK_URL))
  assert.deepEqual(qrMatrix(driver.href), qrMatrix(WEB_DRIVER_URL))
})

test('marketing features exact copy snapshot', (t) => {
  t.assert.snapshot(MARKETING_FEATURES)
})

test('soft-launch web QR targets stable production book URL', () => {
  assert.equal(WEB_ORIGIN, 'https://clemsonrides.com')
  assert.equal(WEB_BOOK_URL, 'https://clemsonrides.com/#/home')
  assert.equal(WEB_SCHEDULE_URL, 'https://clemsonrides.com/#/schedule')
  assert.doesNotMatch(WEB_ORIGIN, /clemson-rides\.vercel\.app$/)
})

test('marketing homepage uses the Death Valley photo and Clemson palette', () => {
  const source = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/styles/luxury.css', import.meta.url), 'utf8')
  assert.match(source, /\/marketing\/clemson-memorial-stadium\.jpg/)
  assert.match(source, /Clemson Memorial Stadium/)
  assert.match(css, /#F56600/)
  assert.match(css, /#522D80/)
  assert.match(css, /position:\s*fixed/)
  assert.match(css, /mkt-stage-shade/)
  assert.doesNotMatch(css.split('/* Auth */')[0], /background:\s*#f6f7f8/)
})

test('marketing header keeps Book, Drive, and Get the App on a transparent bar', () => {
  const source = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  const css = readFileSync(new URL('../src/styles/luxury.css', import.meta.url), 'utf8')
  const header = source.slice(source.indexOf('<header className='), source.indexOf('</header>'))
  const footer = source.slice(source.indexOf('<footer className="mkt-footer">'), source.indexOf('</footer>'))
  assert.match(header, />Book</)
  assert.match(header, />Drive</)
  assert.match(header, />Get the App</)
  assert.match(header, /navigate\('home'\)/)
  assert.match(header, /navigate\('driver-signup'\)/)
  assert.match(header, /scrollToDownloads/)
  assert.doesNotMatch(header, /This week|Privacy|Terms|service-area|scrollToCoupon/)
  assert.match(footer, /This week/)
  assert.match(footer, /navigate\('service-area'\)/)
  assert.match(footer, />Service area</)
  assert.match(footer, />Privacy</)
  assert.match(footer, />Terms</)
  assert.match(footer, /Book a ride/)
  const navRule = css.match(/body \.mkt-nav \{[^}]+\}/)
  assert.ok(navRule, 'marketing nav rule exists')
  assert.match(navRule[0], /background:\s*transparent/)
  assert.match(navRule[0], /box-shadow:\s*none/)
  assert.match(navRule[0], /border-bottom:\s*none/)
  assert.match(navRule[0], /text-shadow:\s*none/)
  assert.match(navRule[0], /filter:\s*none/)
  assert.doesNotMatch(navRule[0], /255,\s*255,\s*255/)
  const scrolled = css.match(/body \.mkt-nav\.mkt-nav--scrolled \{[^}]+\}/)
  assert.ok(scrolled, 'scrolled nav rule exists')
  assert.match(scrolled[0], /rgba\(82,\s*45,\s*128/)
  assert.match(scrolled[0], /box-shadow:\s*none/)
  assert.match(scrolled[0], /border-bottom:\s*none/)
  assert.match(scrolled[0], /backdrop-filter:\s*none/)
  assert.doesNotMatch(scrolled[0], /blur\(/)
  const labelRule = css.match(/body \.mkt-brand,\s*\nbody \.mkt-nav-links button \{[^}]+\}/)
  assert.ok(labelRule, 'nav label rule exists')
  assert.match(labelRule[0], /text-shadow:\s*none/)
})

test('marketing cards and buttons use frosted glass on phone and desktop', () => {
  const css = readFileSync(new URL('../src/styles/luxury.css', import.meta.url), 'utf8')
  const marketing = css.slice(0, css.indexOf('/* Auth */'))
  const card = marketing.match(/body \.mkt-card,[\s\S]*?\{[^}]+\}/)
  assert.ok(card, 'shared card glass rule exists')
  assert.match(card[0], /background:\s*rgba\(255,\s*255,\s*255,\s*0\.16\)/)
  assert.match(card[0], /backdrop-filter:\s*blur\(16px\)/)
  assert.match(card[0], /-webkit-backdrop-filter:\s*blur\(16px\)/)
  assert.match(card[0], /border:\s*1px solid rgba\(255,\s*255,\s*255,\s*0\.34\)/)
  assert.match(card[0], /box-shadow:\s*none/)
  assert.doesNotMatch(marketing, /@media \(max-width:\s*768px\)/)
  assert.match(marketing, /position:\s*fixed/)
  assert.match(marketing, /@supports not \(\(backdrop-filter: blur\(1px\)\) or \(-webkit-backdrop-filter: blur\(1px\)\)\)/)
  assert.match(marketing, /background:\s*rgba\(18,\s*10,\s*28,\s*0\.92\)/)
  assert.match(marketing, /font-size:\s*17px/)
  assert.match(marketing, /min-height:\s*44px/)
  assert.match(marketing, /min-height:\s*48px/)
  const cta = marketing.match(/body \.mkt \.primary-cta \{[^}]+\}/)
  assert.ok(cta, 'primary button rule exists')
  assert.match(cta[0], /rgba\(245,\s*102,\s*0,\s*0\.45\)/)
  assert.match(cta[0], /color:\s*#fff !important/)
  assert.match(cta[0], /box-shadow:\s*none !important/)
  assert.match(marketing, /rgba\(82,\s*45,\s*128,\s*0\.45\)/)
  const desktop = marketing.slice(marketing.indexOf('@media (min-width: 960px)'))
  assert.match(desktop, /font-size:\s*48px/)
  assert.doesNotMatch(desktop, /background:\s*#fff/)
  assert.doesNotMatch(card[0], /background:\s*#fff/)
})

test('marketing hero surfaces web book QR for soft launch', () => {
  const source = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  assert.match(source, /WEB_BOOK_URL/)
  assert.match(source, /Soft launch · web/)
  assert.match(source, /navigate\('schedule'\)/)
})
