import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expo = JSON.parse(readFileSync(path.join(root, 'apps/driver/app.json'), 'utf8')).expo

const ACTIVE_TRIP =
  'Clemson Rides uses your location while you are online and during trips, including while you use Maps or the phone is locked, so nearby ride requests can reach you and your rider can see your car. Location sharing stops when you go offline.'

function pluginEntry(name) {
  const entry = expo.plugins.find((item) => item === name || (Array.isArray(item) && item[0] === name))
  assert.ok(entry, `${name} plugin missing`)
  return entry
}

function pluginOptions(name) {
  const entry = pluginEntry(name)
  assert.ok(Array.isArray(entry), `${name} must be configured with an options object`)
  return entry[1]
}

test('driver secure store does not add a Face ID purpose string', () => {
  assert.equal(pluginOptions('expo-secure-store').faceIDPermission, false)
})

test('driver location explains motion and keeps active-trip always strings', () => {
  const location = pluginOptions('expo-location')
  assert.equal(
    location.motionUsagePermission,
    'Clemson Rides does not track your motion or activity. iOS requires this notice because a location library we use can read motion data.',
  )
  assert.equal(
    location.locationWhenInUsePermission,
    'Clemson Rides uses your location while you are online so riders can see your car on the map.',
  )
  assert.equal(location.locationAlwaysAndWhenInUsePermission, ACTIVE_TRIP)
  assert.equal(location.locationAlwaysPermission, ACTIVE_TRIP)
  assert.equal(location.isIosBackgroundLocationEnabled, true)
})

test('driver audio stays in the foreground and the plist matches the plugins', () => {
  const audio = pluginOptions('expo-audio')
  const camera = pluginOptions('expo-image-picker')
  assert.equal(audio.enableBackgroundPlayback, false)
  assert.equal(
    audio.microphonePermission,
    'Clemson Rides uses the microphone only when you start an audio or video recording during an active ride. The clip stays on this phone.',
  )
  assert.deepEqual(expo.ios.infoPlist.UIBackgroundModes, ['location'])
  assert.equal(expo.ios.infoPlist.NSMicrophoneUsageDescription, audio.microphonePermission)
  assert.equal(expo.ios.infoPlist.NSCameraUsageDescription, camera.cameraPermission)
})
