import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { BACKGROUND_LOCATION_DISCLOSURE as COPY, shouldShowLocationDisclosure } from '../apps/driver/lib/locationDisclosure.ts'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('disclosure copy meets Play prominent-disclosure wording', () => {
  // What is collected, that it is used in the background, and why.
  assert.match(COPY.body, /collects your location data/)
  assert.match(COPY.body, /even when the app is closed or not in use/)
  assert.match(COPY.body, /show your car to your rider/)
  assert.match(COPY.body, /Clemson Rides Driver/)
  assert.ok(COPY.points.some((p) => /only while you have an active trip/.test(p)))
  assert.ok(COPY.points.some((p) => /stops when the trip ends/.test(p)))
  assert.equal(COPY.accept, 'Continue')
  assert.equal(COPY.decline, 'Not now')
  assert.equal(COPY.next, 'On the next screen, choose "Always".')
  assert.doesNotMatch(JSON.stringify(COPY), /RIDES|Android|Expo/)
})

test('shown only before a missing permission, once per trip', () => {
  assert.equal(shouldShowLocationDisclosure({ granted: true, answeredTripId: null, tripId: 't1' }), false)
  assert.equal(shouldShowLocationDisclosure({ granted: false, answeredTripId: null, tripId: 't1' }), true)
  assert.equal(shouldShowLocationDisclosure({ granted: false, answeredTripId: 't1', tripId: 't1' }), false)
  assert.equal(shouldShowLocationDisclosure({ granted: false, answeredTripId: 't1', tripId: 't2' }), true)
})

test('trip screen shows the disclosure before the OS background prompt and skips the prompt on Not now', () => {
  const trip = read('apps/driver/app/trip.tsx')
  const effect = trip.slice(trip.indexOf('const updateBackgroundLocation'), trip.indexOf('void updateBackgroundLocation()'))
  const check = effect.indexOf('shouldShowLocationDisclosure(')
  const start = effect.indexOf('await startTripBackgroundLocation(trip.id)')
  assert.ok(check > 0 && start > check, 'disclosure check precedes the permission request')
  assert.match(effect, /setDisclosureFor\(trip\.id\)\s*return/)
  assert.match(effect, /!answered\.accepted\)\s*\{\s*setBackgroundNote\(DISCLOSURE_DECLINED_NOTE\)\s*return/)
  assert.match(trip, /<LocationDisclosure visible=/)
  // The only background permission request stays inside startTripBackgroundLocation.
  assert.doesNotMatch(trip, /requestBackgroundPermissionsAsync/)
  const comp = read('apps/driver/components/LocationDisclosure.tsx')
  assert.match(comp, /accessibilityViewIsModal/)
  assert.match(comp, /COPY\.body/)
})
