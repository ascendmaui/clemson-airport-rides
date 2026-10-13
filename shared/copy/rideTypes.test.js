import assert from 'node:assert/strict'
import test from 'node:test'
import { OFFERED_RIDE_TIERS } from '../rideOptions.js'
import {
  RIDE_TYPE_GUIDE,
  RIDE_TYPE_NOTES,
  RIDE_TYPE_ORANGE,
  RIDE_TYPE_PURPLE,
  RIDE_TYPE_STUDENT_NOTE,
} from './rideTypes.js'

test('ride type sheet explains the four bookable types', () => {
  assert.equal(RIDE_TYPE_ORANGE, '#F56600')
  assert.equal(RIDE_TYPE_PURPLE, '#522D80')
  assert.equal(RIDE_TYPE_GUIDE.title, 'Four ways to ride')
  assert.equal(RIDE_TYPE_GUIDE.kicker, 'Ride types')
  assert.equal(RIDE_TYPE_GUIDE.lede, 'The quote on the booking screen is the price before you confirm.')
  assert.deepEqual(RIDE_TYPE_GUIDE.types.map((row) => row.id), [...OFFERED_RIDE_TIERS])
  assert.deepEqual(RIDE_TYPE_GUIDE.types.map((row) => row.name), ['Standard', 'Wait & Save', 'Extra Comfort', 'Carpool'])
  assert.equal(RIDE_TYPE_NOTES.standard, 'The base ride. The fare on the booking screen is the price before you confirm.')
  assert.match(RIDE_TYPE_NOTES.wait, /The student discount does not apply/)
  assert.match(RIDE_TYPE_NOTES.comfort, /Nicer cars/)
  assert.match(RIDE_TYPE_NOTES.comfort, /service class comfort/)
  assert.match(RIDE_TYPE_NOTES.carpool, /50% of the Standard fare per seat/)
  assert.match(RIDE_TYPE_NOTES.carpool, /3 or 4 riders split the trip/)
  assert.doesNotMatch(RIDE_TYPE_NOTES.carpool, /not combined into one car/)
  assert.match(RIDE_TYPE_STUDENT_NOTE, /10% off Standard/)
  assert.match(RIDE_TYPE_STUDENT_NOTE, /@clemson\.edu or @g\.clemson\.edu/)
  assert.match(RIDE_TYPE_STUDENT_NOTE, /Other ride types are not included/)
  assert.deepEqual(
    RIDE_TYPE_GUIDE.types.map((row) => row.color),
    [RIDE_TYPE_ORANGE, RIDE_TYPE_ORANGE, RIDE_TYPE_PURPLE, RIDE_TYPE_PURPLE],
  )
  const joined = JSON.stringify(RIDE_TYPE_GUIDE)
  assert.doesNotMatch(joined, /Uber|Lyft/)
  assert.doesNotMatch(joined, /~20%/)
})
