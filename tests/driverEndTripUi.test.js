import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('driver surfaces reconcile on an interval and offer End trip in every active state', () => {
  const home = read('apps/driver/app/(tabs)/index.tsx')
  const trip = read('apps/driver/app/trip.tsx')
  const web = read('src/screens/DriverHome.jsx')
  for (const source of [home, trip, web]) {
    assert.match(source, /DriverEndTripSheet/)
    assert.match(source, /sendTripHeartbeat/)
  }
  assert.match(home, /AppState.addEventListener\('change'/)
  assert.match(home, /ACTIVE_TRIP_RECONCILE_MS/)
  assert.match(home, /subscribeTrips\(supabase/)
  assert.match(web, /reconcileActiveTrip/)
  assert.match(web, /onTrackingResume/)
  assert.match(web, /ACTIVE_STATUSES\.includes\(activeTrip\.status\) && <DriverEndTripSheet/)
  assert.match(trip, /canDriverEnd\(trip\.status\) \? <DriverEndTripSheet/)
  const nativeSheet = read('apps/driver/components/DriverEndTripSheet.tsx')
  const webSheet = read('src/components/DriverEndTripSheet.jsx')
  for (const sheet of [nativeSheet, webSheet]) {
    assert.match(sheet, /validateDriverEnd/)
    assert.match(sheet, /driverEndTrip\(/)
    assert.match(sheet, /Keep trip/)
  }
})
