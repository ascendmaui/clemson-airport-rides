import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { isQuietNow, newRideAlertAllowed } from '../packages/rides-native/offerAlertGate.js'

// Clemson time: October is EDT (UTC-4), so NY hh:mm = UTC hh+4.
const at = (h, m = 0) => new Date(Date.UTC(2026, 9, 12, h + 4, m))

test('offline drivers never get a new-ride alert', () => {
  assert.equal(newRideAlertAllowed({ online: false, prefs: null }), false)
  assert.equal(newRideAlertAllowed({ online: true, prefs: null }), true)
})

test('quiet hours, DND, and ride alerts off silence the alert', () => {
  const night = { quiet: { scheduleEnabled: true, start: '22:00', end: '07:00' } }
  assert.equal(isQuietNow(night, at(23)), true)
  assert.equal(isQuietNow(night, at(6, 59)), true)
  assert.equal(isQuietNow(night, at(7)), false)
  assert.equal(newRideAlertAllowed({ online: true, prefs: night, now: at(2) }), false)
  assert.equal(newRideAlertAllowed({ online: true, prefs: night, now: at(12) }), true)
  assert.equal(newRideAlertAllowed({ online: true, prefs: { quiet: { dnd: true } } }), false)
  assert.equal(newRideAlertAllowed({ online: true, prefs: { ride: false } }), false)
})

test('OfferBridge gates notifications and pulses on the shared rule', () => {
  const src = readFileSync(new URL('../apps/driver/components/OfferBridge.tsx', import.meta.url), 'utf8')
  assert.match(src, /if \(!next \|\| !desk\.online\) return/)
  assert.doesNotMatch(src, /if \(next\) notifyNewRequest\(next\)/)
  assert.match(src, /if \(alertOk\) armPulse/)
  assert.match(src, /if \(!alertOk\) return\s*pulse\('request'/)
  assert.match(src, /if \(alertOk\) notifyScheduledBoard/)
  assert.match(src, /if \(newRideAlertAllowed\(\{ online: true, prefs \}\)\) armPulse\(tier\)/)
})

test('driver SOS sheet buzzes once when it opens', () => {
  const src = readFileSync(new URL('../apps/driver/components/SosSheet.tsx', import.meta.url), 'utf8')
  assert.match(src, /if \(open\) Haptics\.notificationAsync\(Haptics\.NotificationFeedbackType\.Warning\)/)
})
