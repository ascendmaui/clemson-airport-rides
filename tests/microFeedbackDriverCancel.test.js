import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('cancel pulse is an Error haptic and never plays the ride sound', () => {
  const fb = read('apps/driver/lib/feedback.tsx')
  assert.match(fb, /'complete' \| 'cancel'/)
  assert.match(fb, /case 'decline':\s*case 'cancel':\s*return Haptics\.NotificationFeedbackType\.Error/)
  // Sound only for accept/complete (and tier-gated request).
  assert.match(fb, /soundsRef\.current && \(kind === 'accept' \|\| kind === 'complete'\)/)
})

test('rider cancel, no-show, and driver cancel use the cancel pulse, not complete', () => {
  const trip = read('apps/driver/app/trip.tsx')
  assert.match(trip, /!canceledView\) return\s*\/\/[^\n]*\n\s*pulse\('cancel'\)/)
  assert.match(trip, /locationTracking\.stop\(\)\s*pulse\('cancel'\)/)
})
