import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(path.join(ROOT, rel), 'utf8')
}

test('pickup and drop-off each have a current-location control that pins the map', () => {
  const webField = read('src/components/AddressSuggest.jsx')
  const nativeField = read('apps/rider/components/carpool/NeighborhoodPicker.tsx')
  const webConfirm = read('src/screens/ConfirmPickup.jsx')
  const nativeConfirm = read('apps/rider/app/confirm.tsx')
  const picker = read('src/components/PlacePicker.jsx')

  assert.match(webField, /Use current location as pickup/)
  assert.match(webField, /Use current location as drop-off/)
  assert.match(nativeField, /Use current location as pickup/)
  assert.match(nativeField, /Use current location as drop-off/)
  assert.match(picker, /Use current location as drop-off/)
  assert.match(webConfirm, /pickupPosition/)
  assert.match(webConfirm, /dropoffPosition/)
  assert.match(nativeConfirm, /id: 'pickup'/)
  assert.match(nativeConfirm, /id: 'dropoff'/)
})

test('the live pickup stream does not feed demo drivers into matching, ETA, or price', () => {
  const stream = read('packages/rides-native/riderLivePickup.js')
  const endpoint = read('server/endpoints/riderLivePickup.js')
  const hook = read('apps/rider/lib/useRiderPickupStream.ts')
  for (const source of [stream, endpoint, hook]) {
    assert.doesNotMatch(source, /simulatedDrivers|tesla|robotaxi/)
  }
  assert.match(endpoint, /update\(\{ metadata \}\)/)
  assert.doesNotMatch(endpoint, /fare_cents|pickup_lat/)
  assert.match(read('apps/rider/components/RiderTripEnd.tsx'), /Complete trip/)
  assert.match(read('apps/rider/components/ApproachAlert.tsx'), /playApproachPing/)
})
