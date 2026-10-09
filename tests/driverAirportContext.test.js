import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { toDriverCard } from '../packages/rides-native/tripTags.js'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('driver cards carry airport context for airport trips only', () => {
  const card = toDriverCard({ id: 't', status: 'offered', pickup_label: 'Cooper Library', dropoff_label: 'GSP Airport', flight: 'DL 1234', metadata: { airport: 'GSP' } })
  assert.equal(card.airportContext.line, 'GSP · Departures · Delta DL 1234')
  assert.equal(toDriverCard({ id: 't', status: 'offered', pickup_label: 'A', dropoff_label: 'B', metadata: {} }).airportContext, null)
})

test('offer, queue and trip screens show the airport line', () => {
  assert.match(read('apps/driver/app/(tabs)/index.tsx'), /card\.airportContext \? \(/)
  assert.match(read('apps/driver/app/queue.tsx'), /card\.airportContext \? <Text/)
  assert.match(read('apps/driver/app/trip.tsx'), /trip\.airportContext\.flightLine/)
  assert.match(read('packages/rides-native/driverDesk.js'), /'flight',/)
})

test('rider booking has an optional flight field on native and web', () => {
  const native = read('apps/rider/app/schedule.tsx')
  assert.match(native, /Flight \(optional\)/)
  assert.match(native, /flight: \{ number: flightNumber\.trim\(\), time: flightTime\.trim\(\) \}/)
  const web = read('src/screens/ScheduleAirport.jsx')
  assert.match(web, /Flight number \(optional\)/)
  for (const path of ['server/endpoints/airportCheckout.js', 'server/endpoints/scheduleTrip.js', 'server/endpoints/requestDriverTrip.js', 'api/create-checkout-session.js']) {
    assert.match(read(path), /flightFromBody\(body\)/, path)
  }
})
