import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const expo = JSON.parse(readFileSync(path.join(root, 'apps/driver/app.json'), 'utf8')).expo

const ACTIVE_TRIP =
  'Clemson RIDES uses your location during an active trip, including while you use Maps or the phone is locked, so your rider can see your car and knows when you arrive. Location sharing stops when the trip ends.'

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

test('driver location omits motion and keeps active-trip always strings', () => {
  const location = pluginOptions('expo-location')
  assert.equal(location.motionUsagePermission, false)
  assert.equal(
    location.locationWhenInUsePermission,
    'Clemson RIDES uses your location while you are online so riders can see your car on the map.',
  )
  assert.equal(location.locationAlwaysAndWhenInUsePermission, ACTIVE_TRIP)
  assert.equal(location.locationAlwaysPermission, ACTIVE_TRIP)
  assert.equal(location.isIosBackgroundLocationEnabled, true)
})

test('driver audio plugin is unchanged', () => {
  const audio = pluginOptions('expo-audio')
  assert.equal(Object.hasOwn(audio, 'enableBackgroundPlayback'), false)
  assert.equal(
    audio.microphonePermission,
    'Clemson RIDES uses the microphone only when you start an audio or video recording during an active ride. The clip stays on this phone.',
  )
})
