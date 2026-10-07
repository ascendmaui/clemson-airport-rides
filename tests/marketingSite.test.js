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

test('marketing hero surfaces web book QR for soft launch', () => {
  const source = readFileSync(new URL('../src/screens/Marketing.jsx', import.meta.url), 'utf8')
  assert.match(source, /WEB_BOOK_URL/)
  assert.match(source, /Soft launch · web/)
  assert.match(source, /navigate\('schedule'\)/)
})
