import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('the driver trip screen shows the ordered stop list only for carpools', () => {
  const trip = read('apps/driver/app/trip.tsx')
  assert.match(trip, /multiStop && !terminalTrip \? <StopList stops=\{stops\}/)
  assert.match(trip, /trip\.status === 'arrived' && !multiStop \? \(\s*<RiderConfirmCard/)
  assert.match(trip, /trip\?\.status === 'arriving' && !multiStop/)
  // Complete trip only after every stop is resolved.
  assert.match(trip, /\(!multiStop \|\| \(stopsDone && trip\?\.status === 'in_progress'\)\)/)
  assert.match(trip, /driverStopAction\(supabase, trip\.id, stop\.index, op\)/)
})

test('stop actions go through the server and settle refuses open stops', () => {
  const desk = read('packages/rides-native/driverDesk.js')
  assert.match(desk, /'\/api\/driver\?action=trip-stop'/)
  assert.match(read('api/driver.js'), /'trip-stop': handleTripStop/)
  const settle = read('server/tripSettle.js')
  assert.match(settle, /stopFlowStarted\(trip\) && !allStopsDone\(tripStops\(trip\)\)/)
  // Checked before and again after the completion claim.
  assert.equal(settle.match(/!override && stopsPending\(trip\)/g).length, 2)
  assert.match(read('server/endpoints/tripWait.js'), /action === 'complete'[\s\S]*stopFlowStarted\(read\.data\) && !allStopsDone/)
})
