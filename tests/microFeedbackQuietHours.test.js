import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { formatHhmm, hhmmLabel, inWindow, isQuietAt, minutesInZone, parseHhmm } from '../shared/quietWindow.js'
import { isQuietForDriverOffer } from '../server/driverOfferAlerts.js'
import { newRideAlertAllowed } from '../packages/rides-native/offerAlertGate.js'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')
// Clemson clock helpers. EDT (UTC-4) in October, EST (UTC-5) in January.
const edt = (h, m = 0) => new Date(Date.UTC(2026, 9, 12, h + 4, m))
const est = (h, m = 0) => new Date(Date.UTC(2026, 0, 15, h + 5, m))

test('same-day window: start inclusive, end exclusive', () => {
  const s = parseHhmm('13:00')
  const e = parseHhmm('17:30')
  assert.equal(inWindow(s - 1, s, e), false)
  assert.equal(inWindow(s, s, e), true)
  assert.equal(inWindow(e - 1, s, e), true)
  assert.equal(inWindow(e, s, e), false)
})

test('window crossing midnight wraps (22:00–07:00)', () => {
  const s = parseHhmm('22:00')
  const e = parseHhmm('07:00')
  for (const [hhmm, quiet] of [['21:59', false], ['22:00', true], ['23:59', true], ['00:00', true], ['03:15', true], ['06:59', true], ['07:00', false], ['12:00', false]]) {
    assert.equal(inWindow(parseHhmm(hhmm), s, e), quiet, hhmm)
  }
})

test('start === end means all day; invalid times never silence', () => {
  assert.equal(inWindow(600, 480, 480), true)
  assert.equal(isQuietAt({ scheduleEnabled: true, start: '25:00', end: '07:00' }, edt(23)), false)
  assert.equal(isQuietAt({ scheduleEnabled: false, start: '22:00', end: '07:00' }, edt(23)), false)
  assert.equal(isQuietAt({ dnd: true }, edt(12)), true)
  assert.equal(isQuietAt(null, edt(12)), false)
})

test('uses America/New_York regardless of the machine zone, across DST', () => {
  const q = { scheduleEnabled: true, start: '22:00', end: '07:00' }
  assert.equal(minutesInZone(edt(23, 30)), 23 * 60 + 30)
  assert.equal(minutesInZone(est(6, 45)), 6 * 60 + 45)
  assert.equal(isQuietAt(q, edt(23, 30)), true)
  assert.equal(isQuietAt(q, edt(7, 0)), false)
  assert.equal(isQuietAt(q, est(6, 59)), true)
  assert.equal(isQuietAt(q, est(7, 0)), false)
  // 02:30 UTC is 22:30 EDT (quiet) even though UTC clock reads 02:30.
  assert.equal(isQuietAt({ scheduleEnabled: true, start: '22:00', end: '23:00' }, new Date('2026-10-13T02:30:00Z')), true)
})

test('time helpers', () => {
  assert.equal(formatHhmm(-30), '23:30')
  assert.equal(formatHhmm(1440 + 30), '00:30')
  assert.equal(hhmmLabel('00:00'), '12:00 AM')
  assert.equal(hhmmLabel('22:30'), '10:30 PM')
  assert.equal(parseHhmm('7:00'), null)
})

test('app gate and server push gate use the same window', () => {
  const prefs = { quiet: { scheduleEnabled: true, start: '22:00', end: '07:00' } }
  for (const at of [edt(21, 59), edt(22), edt(2), edt(7), edt(15)]) {
    const quiet = isQuietForDriverOffer(prefs, at)
    assert.equal(newRideAlertAllowed({ online: true, prefs, now: at }), !quiet)
  }
  assert.equal(isQuietForDriverOffer(prefs, edt(2)), true)
})

test('driver settings expose Quiet hours and save to the account prefs', () => {
  const section = read('apps/driver/app/settings/[section].tsx')
  assert.match(section, /'quiet-hours'\] as const/)
  assert.match(section, /\{section === 'quiet-hours' \? <QuietHoursChoices \/> : null\}/)
  assert.match(read('apps/driver/app/settings/index.tsx'), /title: 'Quiet hours'[\s\S]{0,120}router\.push\('\/settings\/quiet-hours'\)/)
  const ui = read('apps/driver/components/QuietHoursChoices.tsx')
  assert.match(ui, /saveDriverQuiet\(user\.id, next\)/)
  assert.match(ui, /label="Quiet hours"/)
  const lib = read('apps/driver/lib/quietHours.ts')
  assert.match(lib, /saveNotificationPrefs\(supabase, authStorage, userId, next\)/)
  assert.match(read('apps/driver/components/OfferBridge.tsx'), /prefs = await driverAlertPrefs\(user\.id\)/)
})
