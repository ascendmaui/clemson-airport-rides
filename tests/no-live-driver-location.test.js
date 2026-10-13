import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { liveFixFromReads } from '../packages/rides-native/liveFix.js'
import { distanceMeters, isLiveTrip, publishWebLiveFix, shouldPublishLocation } from '../src/lib/liveDriverLocation.js'

// Covered by the existing tests/no*.test.js entry in package.json.
test('only active trip states enable private location tracking', () => {
  assert.equal(isLiveTrip('accepted'), true)
  assert.equal(isLiveTrip('in_progress'), true)
  assert.equal(isLiveTrip('completed'), false)
  assert.equal(isLiveTrip('searching'), false)
})

test('location publishing throttles by time but sends meaningful movement promptly', () => {
  const last = { lat: 34.6784, lng: -82.8397, publishedAt: 1000 }
  assert.equal(shouldPublishLocation(last, { lat: 34.67841, lng: -82.8397 }, 3000), false)
  assert.equal(shouldPublishLocation(last, { lat: 34.6784, lng: -82.8395 }, 3000), true)
  assert.equal(shouldPublishLocation(last, { lat: 34.67841, lng: -82.8397 }, 5000), true)
  assert.ok(distanceMeters(last, { lat: 34.6784, lng: -82.8395 }) > 15)
})

function memoryClient() {
  const tables = {}
  return {
    tables,
    from(table) {
      const state = { payload: null, error: null }
      const builder = {
        upsert(row) {
          state.payload = row
          return builder
        },
        then(resolve, reject) {
          try {
            if (state.error) {
              resolve({ data: null, error: state.error })
              return
            }
            const rows = tables[table] || (tables[table] = [])
            rows.push(state.payload)
            resolve({ data: state.payload, error: null })
          } catch (err) {
            reject(err)
          }
        },
      }
      return builder
    },
  }
}

test('web live publish writes presence without changing online, and the trip row while on a trip', async () => {
  const client = memoryClient()
  const idle = await publishWebLiveFix(client, {
    driverId: 'driver-1',
    coords: { latitude: 34.68, longitude: -82.83, heading: -1, speed: 3 },
  })
  assert.deepEqual(idle, { presence: true, trip: false })
  assert.equal(client.tables.driver_status.length, 1)
  assert.equal(client.tables.driver_status[0].lat, 34.68)
  assert.equal(client.tables.driver_status[0].heading, null)
  assert.equal('online' in client.tables.driver_status[0], false)
  assert.equal(client.tables.trip_driver_locations, undefined)

  const live = await publishWebLiveFix(client, {
    tripId: 'trip-1',
    driverId: 'driver-1',
    coords: { latitude: 34.681, longitude: -82.831, heading: 180, speed: 5 },
  })
  assert.deepEqual(live, { presence: true, trip: true })
  assert.equal(client.tables.trip_driver_locations[0].trip_id, 'trip-1')
  assert.equal(client.tables.trip_driver_locations[0].heading, 180)
  assert.equal(client.tables.trip_driver_locations[0].speed, 5)
  assert.equal('online' in client.tables.trip_driver_locations[0], false)
})

test('riders prefer the trip row and fall back to presence when it is empty', () => {
  const trip = liveFixFromReads({
    tripRow: { lat: 1, lng: 2, updated_at: 'trip-time' },
    statusRow: { lat: 9, lng: 9, location_updated_at: 'status-time' },
  })
  assert.equal(trip.fix.lat, 1)
  assert.equal(trip.fix.updatedAt, 'trip-time')

  const fallback = liveFixFromReads({
    tripRow: null,
    statusRow: { lat: 34.6, lng: -82.8, location_updated_at: 'status-time' },
  })
  assert.equal(fallback.fix.lat, 34.6)
  assert.equal(fallback.fix.updatedAt, 'status-time')

  const missingTable = liveFixFromReads({
    tripError: { message: 'Could not find the table trip_driver_locations in the schema cache' },
    statusRow: { lat: 3, lng: 4, location_updated_at: 'status-time' },
  })
  assert.equal(missingTable.fix.lat, 3)
  assert.equal(missingTable.error, null)

  const bothFailed = liveFixFromReads({
    tripError: { message: 'network down' },
    statusError: { message: 'presence down' },
  })
  assert.equal(bothFailed.fix, null)
  assert.equal(bothFailed.error.message, 'network down')
})

test('the website driver publishes presence while online and the trip row on a live shift or a departing backup', () => {
  const home = readFileSync(new URL('../src/screens/DriverHome.jsx', import.meta.url), 'utf8')
  assert.match(home, /const tracking = Boolean\(approved && \(online \|\| liveTripId\)\)/)
  assert.match(home, /const backupEnroute = readBackupQueue\(activeTrip\)\?\.confirmState === 'enroute'/)
  assert.match(home, /tripId: liveTripId && \(online \|\| backupEnroute\) \? liveTripId : null/)
  const publisher = readFileSync(new URL('../src/lib/liveDriverLocation.js', import.meta.url), 'utf8')
  assert.match(publisher, /from\('driver_status'\)/)
  assert.match(publisher, /from\('trip_driver_locations'\)/)
  assert.doesNotMatch(publisher, /online:\s*true/)
})
