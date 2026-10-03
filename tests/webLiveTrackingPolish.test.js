import assert from 'node:assert/strict'
import test from 'node:test'
import {
  STILL_SEARCHING_COPY,
  STILL_SEARCHING_MS,
  SEARCH_PREVIEW_COPY,
  showSearchTheater,
} from '../packages/rides-native/liveTrip.js'
import { TESLA_FLEET_NOTICE, teslaFleetNotice } from '../packages/rides-native/tripTags.js'
import { depositSurfaceCopy } from '../packages/rides-native/riderMoney.js'

test('live tracking polish exports still-searching copy and search theater', () => {
  assert.equal(typeof STILL_SEARCHING_COPY, 'string')
  assert.match(STILL_SEARCHING_COPY, /Still looking/i)
  assert.ok(STILL_SEARCHING_MS >= 30000)
  assert.equal(showSearchTheater('searching'), true)
  assert.equal(showSearchTheater('accepted'), false)
  assert.match(SEARCH_PREVIEW_COPY, /preview/i)
})

test('deposit surface confirm copy still names 25 percent', () => {
  const copy = depositSurfaceCopy({ fareCents: 8000, depositCents: 2000, remainingCents: 6000 }, 'confirm')
  assert.match(copy, /25% deposit/)
  assert.match(copy, /\$20\.00/)
})

test('retired fleet notice is not rendered', () => {
  assert.equal(TESLA_FLEET_NOTICE, '')
  assert.equal(teslaFleetNotice(true), null)
  assert.doesNotMatch(TESLA_FLEET_NOTICE, /self-driving|robotaxi|Tesla/i)
})
