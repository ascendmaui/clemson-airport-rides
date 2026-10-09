import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('native live trip renders the new sheet only for accepted/arriving and stops location before leaving', () => {
  const source = read('apps/driver/app/trip.tsx')
  assert.match(source, /trip && \['accepted', 'arriving'\]\.includes\(trip.status\) \? <DriverCancelSheet/)
  assert.match(source, /scheduled=\{Boolean\(trip.pickupAt\)\}/)
  assert.match(source, /function onDriverCanceled\(\) \{\s*locationTracking.stop\(\)\s*pulse\('complete'\)\s*router.replace\('\/'\)/)
  assert.equal((source.match(/<DriverCancelSheet /g) || []).length, 1)
  const sheet = read('apps/driver/components/DriverCancelSheet.tsx')
  assert.match(sheet, /if \(scheduled\) return null/)
  assert.match(sheet, /driverCancelTrip\(supabase, tripId, reason/)
  assert.match(sheet, /maxLength=\{200\}/)
  assert.match(sheet, /Alert.alert\('Trip canceled', DRIVER_CANCEL_SUCCESS\)/)
})

test('riders deduplicate cancellation announcements and keep the existing rider controls', () => {
  const native = read('apps/rider/app/requested.tsx'), web = read('src/screens/Requested.jsx')
  for (const source of [native, web]) {
    assert.match(source, /driverCancelNotice\(/)
    assert.match(source, /seenDriverCancels.current.set\(/)
    assert.match(source, /cancelNotice.*searching/)
    assert.match(source, /RiderSwitchSheet/)
  }
  assert.match(native, /AccessibilityInfo.announceForAccessibility\(notice.message\)/)
  assert.match(web, /AccessibleAlert.*role="alert" ariaLive="assertive" message=\{cancelNotice.message\}/)
  const driver = read('src/screens/DriverHome.jsx')
  assert.match(driver, /\['accepted', 'arriving'\].includes\(activeTrip.status\).*<DriverCancelSheet/)
  assert.match(driver, /stopTripLocation.current\?\.\(\)/)
})
