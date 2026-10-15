import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expo = JSON.parse(readFileSync(path.join(root, 'apps/rider/app.json'), 'utf8')).expo

function pluginOptions(name) {
  const entry = expo.plugins.find((item) => item === name || (Array.isArray(item) && item[0] === name))
  assert.ok(entry, `${name} plugin missing`)
  assert.ok(Array.isArray(entry), `${name} must be configured with an options object`)
  return entry[1]
}

test('rider secure store does not add a Face ID purpose string', () => {
  assert.equal(pluginOptions('expo-secure-store').faceIDPermission, false)
})

test('rider location stays when-in-use, explains motion, and omits always keys', () => {
  const location = pluginOptions('expo-location')
  assert.equal(
    location.locationWhenInUsePermission,
    'Clemson Rides uses your location to set your pickup point and show your driver approaching.',
  )
  assert.equal(
    location.motionUsagePermission,
    'Clemson Rides does not track your motion or activity. iOS requires this notice because a location library we use can read motion data.',
  )
  assert.equal(location.locationAlwaysAndWhenInUsePermission, false)
  assert.equal(location.locationAlwaysPermission, false)
  assert.notEqual(location.isIosBackgroundLocationEnabled, true)
  assert.equal(expo.ios.infoPlist.NSLocationWhenInUseUsageDescription, location.locationWhenInUsePermission)
  assert.equal(expo.ios.infoPlist.NSMicrophoneUsageDescription, pluginOptions('expo-audio').microphonePermission)
  assert.equal(expo.ios.infoPlist.NSCameraUsageDescription, pluginOptions('expo-image-picker').cameraPermission)
  assert.equal(expo.ios.infoPlist.UIBackgroundModes, undefined)
})

test('rider audio does not enable background playback', () => {
  assert.equal(pluginOptions('expo-audio').enableBackgroundPlayback, false)
})
