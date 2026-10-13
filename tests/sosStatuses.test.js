import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { ACTIVE_RIDE_STATUSES, SHAREABLE_TRIP_STATUSES, isActiveRideStatus, isShareableTripStatus } from '../packages/rides-native/safety.js'
import { ACTIVE_RIDE_STATUSES as WEB_ACTIVE, isActiveRideStatus as webActive } from '../src/lib/sosAlert.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const live = ['accepted', 'arriving', 'arrived', 'in_progress']

test('native and web SOS cover every live status and exclude terminal statuses', () => {
  assert.deepEqual(ACTIVE_RIDE_STATUSES, live)
  assert.deepEqual(WEB_ACTIVE, live)
  assert.deepEqual(SHAREABLE_TRIP_STATUSES, ['searching', 'offered', ...live])
  for (const status of live) {
    assert.equal(isActiveRideStatus(status), true)
    assert.equal(webActive(status), true)
    assert.equal(isShareableTripStatus(status), true)
  }
  for (const status of ['completed', 'canceled', 'canceled_midride', 'cancelled_wait', 'scheduled', null, undefined, '']) {
    assert.equal(isActiveRideStatus(status), false)
    assert.equal(webActive(status), false)
    assert.equal(isShareableTripStatus(status), false)
  }
})

test('rider native and web safety and sharing use the updated gates', () => {
  for (const path of ['apps/rider/components/SosSheet.tsx', 'apps/rider/app/safety.tsx', 'apps/rider/app/requested.tsx']) {
    assert.match(read(path), /isActiveRideStatus\(/, path)
    assert.match(read(path), /from 'rides-native\/safety\.js'/, path)
  }
  assert.match(read('apps/rider/lib/useRiderTrip.ts'), /\.in\('status', \[\.\.\.SHAREABLE_TRIP_STATUSES\]\)/)
  assert.match(read('apps/rider/components/LiveShareCard.tsx'), /isShareableTripStatus\(trip\.status\)/)
  assert.match(read('src/screens/Requested.jsx'), /const rideLive = isActiveRideStatus\(status\)/)
  assert.match(read('src/components/SosControl.jsx'), /setVisible\(isActiveRideStatus\(data\?\.status\)\)/)
  assert.match(read('src/screens/FriendRide.jsx'), /<SosControl tripId=\{ride\.trip_id\}/)
  for (const [path, constant] of [['src/components/SafetyHub.jsx', 'ACTIVE'], ['src/screens/DriverHome.jsx', 'ACTIVE_STATUSES']]) {
    const statuses = read(path).match(new RegExp(`const ${constant} = \\[([^\\]]+)\\]`))[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1))
    assert.deepEqual(statuses, live, path)
  }
})
