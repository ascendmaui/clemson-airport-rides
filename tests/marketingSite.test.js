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
