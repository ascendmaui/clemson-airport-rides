import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  PICKUP_BEACON_DRIVER_PROMPT,
  PICKUP_BEACON_ENTER_METERS,
  PICKUP_BEACON_EXIT_METERS,
  PICKUP_BEACON_ORANGE,
  PICKUP_BEACON_RIDER_PROMPT,
  PICKUP_CODE_ALPHABET,
  alreadyOnLiveRide,
  generatePickupCode,
  haversineMeters,
  isPickupCode,
  isTripDismissed,
  loadDismissedPickupBeacons,
  nearestBeaconMeters,
  persistDismissedPickupBeacon,
  pickupBeaconLiveRide,
  pickupBeaconPrompt,
  pickupBeaconPulse,
  pickupBeaconShouldShow,
  pickupCodeForViewer,
  rememberDismissal,
  viewerMayReadPickupCode,
} from './pickupBeacon.js'

const root = new URL('../', import.meta.url)

function read(rel) {
  return readFileSync(new URL(rel, root), 'utf8')
}

function memoryStore(seed = null) {
  const bag = new Map()
  if (seed != null) bag.set('pickup.beacon.dismissed', seed)
  return {
    async getItem(key) {
      return bag.has(key) ? bag.get(key) : null
    },
    async setItem(key, value) {
      bag.set(key, value)
    },
  }
}

const origin = { lat: 34.6788, lng: -82.8432 }

function pointAtMeters(meters) {
  let lo = 0
  let hi = 0.02
  for (let i = 0; i < 48; i += 1) {
    const mid = (lo + hi) / 2
    const distance = haversineMeters(origin.lat, origin.lng, origin.lat + mid, origin.lng)
    if (distance == null || distance < meters) lo = mid
    else hi = mid
  }
  return { lat: origin.lat + (lo + hi) / 2, lng: origin.lng }
}

const near = {
  status: 'arriving',
  code: 'K7M',
  driver: origin,
  rider: origin,
  pickup: origin,
  dismissed: false,
  wasOpen: false,
}

test('pickup codes are short, uppercase, and omit O, 0, I, and 1', () => {
  assert.equal(PICKUP_CODE_ALPHABET.includes('O'), false)
  assert.equal(PICKUP_CODE_ALPHABET.includes('0'), false)
  assert.equal(PICKUP_CODE_ALPHABET.includes('I'), false)
  assert.equal(PICKUP_CODE_ALPHABET.includes('1'), false)
  assert.equal(isPickupCode('K7M'), true)
  assert.equal(isPickupCode('AB'), true)
  assert.equal(isPickupCode('A'), false)
  assert.equal(isPickupCode('k7m'), false)
  assert.equal(isPickupCode('O1K'), false)
  assert.equal(isPickupCode('I2K'), false)
  assert.equal(isPickupCode('A0K'), false)
  const seen = new Set()
  for (let i = 0; i < 200; i += 1) {
    const code = generatePickupCode()
    assert.match(code, /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{3}$/)
    seen.add(code)
  }
  assert.ok(seen.size > 20)
  const fixed = generatePickupCode(() => 0)
  assert.equal(fixed, 'AAA')
})

test('haversine distance opens inside 50 ft and holds through the outer band', () => {
  assert.equal(haversineMeters(origin.lat, origin.lng, origin.lat, origin.lng), 0)
  assert.equal(haversineMeters(Number.NaN, 0, 0, 0), null)
  const inside = pointAtMeters(PICKUP_BEACON_ENTER_METERS - 1)
  const outside = pointAtMeters(PICKUP_BEACON_ENTER_METERS + 1)
  const held = pointAtMeters((PICKUP_BEACON_ENTER_METERS + PICKUP_BEACON_EXIT_METERS) / 2)
  const released = pointAtMeters(PICKUP_BEACON_EXIT_METERS + 2)
  assert.ok(nearestBeaconMeters(origin, [inside]) < PICKUP_BEACON_ENTER_METERS)
  assert.ok(nearestBeaconMeters(origin, [outside]) > PICKUP_BEACON_ENTER_METERS)
  assert.equal(pickupBeaconShouldShow({ ...near, rider: null, pickup: inside }), true)
  assert.equal(pickupBeaconShouldShow({ ...near, rider: null, pickup: outside }), false)
  assert.equal(pickupBeaconShouldShow({ ...near, rider: outside, pickup: inside }), true)
  assert.equal(pickupBeaconShouldShow({ ...near, rider: inside, pickup: released }), true)
  assert.equal(pickupBeaconShouldShow({ ...near, rider: released, pickup: released }), false)
  assert.equal(pickupBeaconShouldShow({ ...near, rider: null, pickup: held, wasOpen: true }), true)
  assert.equal(pickupBeaconShouldShow({ ...near, rider: null, pickup: released, wasOpen: true }), false)
  assert.equal(pickupBeaconShouldShow({ ...near, rider: null, pickup: outside, wasOpen: false }), false)
  assert.equal(pickupBeaconShouldShow({ ...near, driver: null, pickup: inside }), false)
})

test('the beacon hides when the trip starts, ends, or is cancelled', () => {
  for (const status of ['in_progress', 'completed', 'canceled', 'cancelled', 'canceled_midride', 'cancelled_wait', 'searching', 'offered']) {
    assert.equal(pickupBeaconShouldShow({ ...near, status }), false, status)
  }
  for (const status of ['accepted', 'arriving', 'arrived']) {
    assert.equal(pickupBeaconShouldShow({ ...near, status }), true, status)
  }
  assert.equal(pickupBeaconShouldShow({ ...near, code: null }), false)
  assert.equal(pickupBeaconShouldShow({ ...near, dismissed: true }), false)
})

test('closing the beacon turns the locator off for that trip and a reload does not bring it back', async () => {
  const store = memoryStore()
  assert.equal(pickupBeaconShouldShow(near), true)
  const saved = await persistDismissedPickupBeacon('trip-a', store)
  assert.equal(isTripDismissed(saved, 'trip-a'), true)
  assert.equal(pickupBeaconShouldShow({ ...near, dismissed: isTripDismissed(saved, 'trip-a') }), false)
  assert.equal(pickupBeaconShouldShow({ ...near, dismissed: isTripDismissed(saved, 'trip-b') }), true)

  const reloaded = await loadDismissedPickupBeacons(store)
  assert.equal(isTripDismissed(reloaded, 'trip-a'), true)
  assert.equal(pickupBeaconShouldShow({ ...near, dismissed: isTripDismissed(reloaded, 'trip-a') }), false)

  const both = await persistDismissedPickupBeacon('trip-b', store)
  const again = await loadDismissedPickupBeacons(memoryStore(JSON.stringify(both)))
  assert.equal(pickupBeaconShouldShow({ ...near, dismissed: isTripDismissed(again, 'trip-a') }), false)
  assert.equal(pickupBeaconShouldShow({ ...near, dismissed: isTripDismissed(again, 'trip-b') }), false)
  const untouched = rememberDismissal(again, '')
  assert.equal(isTripDismissed(untouched, 'trip-a'), true)
  assert.equal(isTripDismissed(untouched, 'trip-b'), true)
})

test('only the rider and the matched driver can read the pickup code', () => {
  const trip = { id: 't1', rider_id: 'rider', driver_id: 'driver' }
  assert.equal(viewerMayReadPickupCode(trip, 'rider'), true)
  assert.equal(viewerMayReadPickupCode(trip, 'driver'), true)
  assert.equal(viewerMayReadPickupCode(trip, 'stranger'), false)
  assert.equal(viewerMayReadPickupCode(trip, ''), false)
  assert.equal(viewerMayReadPickupCode({ ...trip, driver_id: null }, 'rider'), false)
  assert.equal(pickupCodeForViewer(trip, 'rider', 'K7M'), 'K7M')
  assert.equal(pickupCodeForViewer(trip, 'driver', 'K7M'), 'K7M')
  assert.equal(pickupCodeForViewer(trip, 'stranger', 'K7M'), null)
  assert.equal(pickupCodeForViewer(trip, 'rider', 'O1K'), null)
  assert.equal(pickupCodeForViewer({ riderId: 'rider', driverId: 'driver' }, 'rider', 'H4P'), 'H4P')
})

test('the rider prompt, orange plate, and slow pulse stay visible', () => {
  assert.equal(PICKUP_BEACON_ORANGE, '#F56600')
  assert.equal(PICKUP_BEACON_RIDER_PROMPT, 'Hold up your phone for your driver to see')
  assert.equal(pickupBeaconPrompt('rider'), PICKUP_BEACON_RIDER_PROMPT)
  assert.equal(pickupBeaconPrompt('driver'), PICKUP_BEACON_DRIVER_PROMPT)
  assert.throws(() => pickupBeaconPrompt('other'), /Unknown pickup beacon role/)
  const moving = pickupBeaconPulse(false)
  assert.equal(moving.enabled, true)
  assert.equal(moving.uiThread, true)
  assert.ok(moving.durationMs >= 800)
  for (const frame of [moving.rest, moving.peak]) {
    assert.ok(frame.opacity > 0 && frame.opacity < 1)
    assert.notEqual(frame.opacity, 0)
  }
  const still = pickupBeaconPulse(true)
  assert.equal(still.enabled, false)
  assert.deepEqual(still.rest, moving.rest)
  assert.deepEqual(pickupBeaconLiveRide('rider', 't1'), { pathname: '/requested', params: { trip: 't1' } })
  assert.deepEqual(pickupBeaconLiveRide('driver', 't1'), { pathname: '/trip', params: { id: 't1' } })
  assert.equal(alreadyOnLiveRide('rider', '/requested'), true)
  assert.equal(alreadyOnLiveRide('driver', '/trip'), true)
  assert.equal(alreadyOnLiveRide('rider', '/'), false)
  assert.equal(alreadyOnLiveRide('driver', '/queue'), false)
})

test('the orange beacon keeps the screen awake, pulses with Reanimated, and closes from the top left', () => {
  const screen = read('packages/rides-native/PickupBeacon.jsx')
  assert.match(screen, /activateKeepAwakeAsync/)
  assert.match(screen, /deactivateKeepAwake/)
  assert.match(screen, /useReducedMotion/)
  assert.match(screen, /useAnimatedStyle/)
  assert.match(screen, /withRepeat/)
  assert.match(screen, /Easing\.inOut\(Easing\.sin\)/)
  assert.match(screen, /pickupBeaconPrompt/)
  assert.match(screen, /PICKUP_BEACON_ORANGE/)
  assert.match(screen, /accessibilityLabel="Close pickup beacon"/)
  assert.match(screen, /insets\.top/)
  assert.match(screen, /insets\.left/)
  assert.match(screen, /minWidth: 64/)
  assert.match(screen, /minHeight: 64/)
  assert.match(screen, /alignItems: 'center'/)
  assert.match(screen, /justifyContent: 'center'/)
  assert.match(screen, /Pickup code/)
  assert.doesNotMatch(screen, /opacity:\s*0\b/)
  assert.doesNotMatch(screen, /withTiming\(\s*0\b/)
  assert.doesNotMatch(screen, /GlassSurface|glassRecipe/)
  assert.doesNotMatch(screen, /te sla|robo taxi/i)

  const riderHost = read('apps/rider/components/PickupBeaconHost.tsx')
  const driverHost = read('apps/driver/components/PickupBeaconHost.tsx')
  const riderHook = read('apps/rider/lib/usePickupBeacon.ts')
  const driverHook = read('apps/driver/lib/usePickupBeacon.ts')
  for (const src of [riderHost, driverHost]) {
    assert.match(src, /beacon\.dismiss\(\)/)
    assert.match(src, /alreadyOnLiveRide/)
    assert.match(src, /pickupBeaconLiveRide/)
  }
  assert.match(riderHost, /role="rider"/)
  assert.match(driverHost, /role="driver"/)
  assert.match(read('apps/rider/app/_layout.tsx'), /PickupBeaconHost/)
  assert.match(read('apps/driver/app/_layout.tsx'), /PickupBeaconHost/)
  for (const src of [riderHook, driverHook]) {
    assert.match(src, /rememberDismissal/)
    assert.match(src, /persistDismissedPickupBeacon/)
    assert.match(src, /loadDismissedPickupBeacons/)
    assert.match(src, /pickupBeaconShouldShow/)
  }
})

test('the compass distance bubble is gone from the rider approach card', () => {
  const alert = read('apps/rider/components/ApproachAlert.tsx')
  assert.match(alert, /if \(!active \|\| paused \|\| reading\) return null/)
  assert.doesNotMatch(alert, /styles\.compass/)
  assert.doesNotMatch(alert, /styles\.feet/)
  assert.doesNotMatch(alert, /styles\.bubble/)
  assert.doesNotMatch(alert, /▲/)
  assert.match(alert, /playApproachPing/)
  assert.match(alert, /approachPulseMotion/)
})
