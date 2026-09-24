import assert from 'node:assert/strict'
import test from 'node:test'
import { isDaylight, sunTimes } from './solar.ts'

const LAT = 34.6784
const LNG = -82.8397

test('Clemson midday in September is daylight', () => {
  const noon = new Date('2026-09-24T16:00:00Z')
  assert.equal(isDaylight(noon, LAT, LNG), true)
})

test('Clemson late night in September is dark', () => {
  const night = new Date('2026-09-24T04:00:00Z')
  assert.equal(isDaylight(night, LAT, LNG), false)
})

test('September sunrise and sunset fall in the expected local window', () => {
  const times = sunTimes(new Date('2026-09-24T16:00:00Z'), LAT, LNG)
  assert.ok(times)
  const riseHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(times.sunrise))
  const setHour = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(times.sunset))
  assert.ok(riseHour >= 6 && riseHour <= 8, `sunrise hour ${riseHour}`)
  assert.ok(setHour >= 18 && setHour <= 20, `sunset hour ${setHour}`)
  assert.ok(times.sunset.getTime() > times.sunrise.getTime())
})
