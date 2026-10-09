import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('native driver config declares active-trip background location on both platforms', () => {
  const { expo } = JSON.parse(read('apps/driver/app.json'))
  const [, location] = expo.plugins.find((plugin) => Array.isArray(plugin) && plugin[0] === 'expo-location')
  const always = 'Clemson RIDES uses your location during an active trip, including while you use Maps or the phone is locked, so your rider can see your car and knows when you arrive. Location sharing stops when the trip ends.'
  assert.equal(location.locationAlwaysAndWhenInUsePermission, always)
  assert.equal(location.locationAlwaysPermission, always)
  assert.equal(location.locationWhenInUsePermission, 'Clemson RIDES uses your location while you are online so riders can see your car on the map.')
  for (const key of ['isIosBackgroundLocationEnabled', 'isAndroidBackgroundLocationEnabled', 'isAndroidForegroundServiceEnabled']) {
    assert.equal(location[key], true, key)
  }
  assert.ok(expo.ios.infoPlist.UIBackgroundModes.includes('location'))
})

test('task registers at startup and orphan tracking reconciles on launch and resume', () => {
  const layout = read('apps/driver/app/_layout.tsx')
  const task = read('apps/driver/lib/backgroundLocation.ts')
  assert.match(layout, /^import '@\/lib\/backgroundLocation'/)
  assert.match(layout, /reconcileTripBackgroundLocation\(\)/)
  assert.match(layout, /AppState\.addEventListener\('change'/)
  assert.match(task, /^TaskManager\.defineTask<.*>\(DRIVER_TRIP_LOCATION_TASK,/m)
  assert.match(task, /authStorage\.setItem\(ACTIVE_TRIP_KEY, tripId\)/)
  assert.match(task, /authStorage\.getItem\(ACTIVE_TRIP_KEY\)/)
  assert.match(task, /if \(!tripId \|\| !await activeTrip\(tripId\)\) await stopUpdates\(\)/)
  assert.match(task, /if \(!user\) return null/)
  assert.match(task, /!trip \|\| !isActiveTripLocationStatus\(trip\.status\)/)
  assert.match(task, /\.eq\('driver_id', user\.id\)/)
})

test('trip screen starts active tracking, stops all terminal trips, and offers Settings on denial', () => {
  const trip = read('apps/driver/app/trip.tsx')
  assert.match(trip, /isActiveTripLocationStatus\(trip\?\.status\)/)
  assert.match(trip, /if \(!activeTrip \|\| terminalTrip \|\| !user\)[\s\S]*?stopTripBackgroundLocation\(trip\.id\)/)
  assert.match(trip, /await startTripBackgroundLocation\(trip\.id\)/)
  assert.match(trip, /\['completed', 'canceled', 'canceled_midride', 'cancelled_wait'\]/)
  assert.match(trip, /if \(!row\) void stopTripBackgroundLocation\(id\)/)
  assert.match(trip, /Set location to Always so your rider can still see you while you use Maps\./)
  assert.match(trip, /Linking\.openSettings\(\)/)
  assert.match(trip, /useDriverLocation\(/)
  assert.match(read('apps/driver/lib/auth.tsx'), /onSignOut: stopTripBackgroundLocation/)
})

test('foreground and background reuse the dual-table publisher and persisted throttle', () => {
  const task = read('apps/driver/lib/backgroundLocation.ts')
  for (const file of ['apps/driver/app/trip.tsx', 'apps/driver/app/(tabs)/index.tsx']) {
    assert.match(read(file), /import \{[^}]*publishDriverLocation[^}]*\} from '@\/lib\/backgroundLocation'/)
  }
  assert.match(task, /publishDriverLocation as writeDriverLocation.*from 'rides-native\/driverDesk'/)
  assert.match(task, /await writeDriverLocation\(client, driverId, fix\)/)
  assert.match(task, /shouldPublishTripLocation\(lastPublishedAt, Date\.now\(\)\)/)
  assert.match(task, /authStorage\.setItem\(LAST_PUBLISH_KEY, String\(Date\.now\(\)\)\)/)
  assert.match(task, /newestTripLocation\(data\?\.locations\)/)
  assert.match(task, /if \(!tripId\) \{ await stopUpdates\(\); return \}/)
  assert.match(task, /if \(!trip\) \{ await stopUpdates\(\); return \}/)
  const foreground = task.indexOf('requestForegroundPermissionsAsync')
  const background = task.indexOf('requestBackgroundPermissionsAsync')
  assert.ok(foreground < background)
  assert.match(task, /foreground\.status !== 'granted'/)
  assert.match(task, /background\.status !== 'granted'/)
  assert.match(task, /hasStartedLocationUpdatesAsync\(DRIVER_TRIP_LOCATION_TASK\)/)
  assert.match(task, /accuracy: Location\.Accuracy\.High/)
  assert.match(task, /activityType: Location\.ActivityType\.AutomotiveNavigation/)
  assert.match(task, /timeInterval: 5000/)
  assert.match(task, /distanceInterval: 15/)
  assert.match(task, /pausesUpdatesAutomatically: false/)
  assert.match(task, /showsBackgroundLocationIndicator: true/)
  assert.match(task, /notificationTitle: 'Clemson RIDES trip in progress'/)
  assert.match(task, /notificationBody: 'Sharing your location with your rider until the trip ends\.'/)
})
