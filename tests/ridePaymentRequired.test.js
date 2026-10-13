import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
}

test('the ride request endpoint rejects a rider with no payment method before insert', () => {
  const source = read('server/endpoints/requestDriverTrip.js')
  const gate = source.indexOf('await assertRiderPaymentMethod')
  const insert = source.indexOf("from('trips').insert")
  const hold = source.indexOf('authorizeRideRequest({')
  assert.ok(gate > 0)
  assert.ok(gate < insert)
  assert.ok(insert < hold)
  assert.match(source, /paymentGate\.code/)
  assert.doesNotMatch(read('server/fareAuthorization.js'), /payment_method_required/)
})

test('native and web booking block Request and return to the same selections after a card is saved', () => {
  const native = read('apps/rider/app/pick-driver.tsx')
  const billing = read('apps/rider/app/billing.tsx')
  const web = read('src/screens/PickDriver.jsx')
  const panel = read('src/components/BillingPanel.jsx')
  const home = read('apps/rider/app/(tabs)/index.tsx')
  assert.match(native, /paymentMethodRequiredError/)
  assert.match(native, /returnTo: 'pick-driver'/)
  assert.match(native, /add: '1'/)
  assert.match(native, /applePay: true/)
  assert.match(billing, /ADD_ANOTHER_PAYMENT_METHOD_ID/)
  assert.match(billing, /router\.back\(\)/)
  assert.match(web, /saveRideRequestDraft/)
  assert.match(web, /setup: 'card'/)
  assert.match(web, /paymentMethodRequiredError/)
  assert.match(panel, /consumeRideRequestDraft/)
  assert.match(panel, /setup === 'card'/)
  assert.match(home, /useHomeLiveTrip/)
  assert.match(home, /liveRideDistanceLine/)
  assert.match(read('apps/rider/app/requested.tsx'), /driverHeartbeatAt/)
  assert.match(read('apps/rider/app/requested.tsx'), /failedHoldPrompt/)
})
