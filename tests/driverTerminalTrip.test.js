import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { driverStatusDetail, statusActionLabel, statusHeadline } from '../packages/rides-native/tripTags.js'

test('canceled trips have friendly headlines, details and no advance action', () => {
  for (const [status, headline, detail] of [
    ['canceled', 'Ride canceled', /ride is canceled/i],
    ['canceled_midride', 'Trip ended early', /rider ended this trip early/i],
    ['cancelled_wait', 'Canceled: rider no-show', /rider did not arrive/i],
  ]) {
    assert.equal(statusHeadline(status), headline)
    assert.match(driverStatusDetail(status), detail)
    assert.doesNotMatch(driverStatusDetail(status), /canceled_midride|cancelled_wait/)
    assert.equal(statusActionLabel(status), null)
  }
  assert.equal(statusActionLabel('completed'), null)
})

test('web clears canceled trips from realtime, polling and wait updates and gates Complete', () => {
  const source = readFileSync(new URL('../src/screens/DriverHome.jsx', import.meta.url), 'utf8')
  assert.match(source, /canceled: 'Ride canceled'/)
  assert.match(source, /canceled_midride: 'The rider ended this trip early'/)
  assert.match(source, /cancelled_wait: 'Canceled: rider no-show'/)
  assert.match(source, /CANCEL_NOTICES\[row\.status\] && activeTripRef\.current\?\.id === row\.id[\s\S]*?clearCanceledTrip\(row\)/)
  assert.match(source, /latest\.data && CANCEL_NOTICES\[latest\.data\.status\]/)
  assert.match(source, /if \(!clearCanceledTrip\(row\)\) setActiveTrip\(row\)/)
  assert.match(source, /if \(activeTrip\) clearCanceledTrip\(activeTrip\)/)
  assert.match(source, /setActiveTrip\(\(current\) => current\?\.id === row\.id \? null : current\)/)
  assert.match(source, /activeTrip && ACTIVE_STATUSES\.includes\(activeTrip\.status\) && \(/)
  const button = source.match(/\{activeTrip\.status === 'in_progress' && \(\s*<PurpleAcceptButton onClick=\{\(\) => advanceTrip\('completed'\)\}[\s\S]*?<\/PurpleAcceptButton>\s*\)\}/)
  assert.ok(button, 'Complete must be rendered only for in_progress')
  assert.match(button[0], /'Complete'/)
  const activeStatuses = source.match(/const ACTIVE_STATUSES = \[([^\]]+)\]/)[1]
  assert.doesNotMatch(activeStatuses, /canceled|cancelled_wait/)
})

test('native stops tracking every terminal trip and offers a Home exit after cancellation', () => {
  const source = readFileSync(new URL('../apps/driver/app/trip.tsx', import.meta.url), 'utf8')
  assert.match(source, /const terminalTrip = Boolean\(trip && \['completed', 'canceled', 'canceled_midride', 'cancelled_wait'\]\.includes\(trip\.status\)\)/)
  assert.match(source, /useDriverLocation\(Boolean\(user && trip && !terminalTrip\)/)
  assert.match(source, /const action = trip && !terminalTrip \? statusActionLabel\(trip\.status\) : null/)
  // Canceled, ended-early, and no-show trips get the "Back to queue" card; anything else keeps Back to Home.
  assert.match(source, /<Primary label=\{canceledView\.action\} onPress=\{\(\) => router\.replace\('\/'\)\}/)
  assert.match(source, /terminalTrip && trip\?\.status !== 'completed' && !canceledView \? <Primary label="Back to Home" onPress=\{\(\) => router\.replace\('\/'\)\}/)
})
