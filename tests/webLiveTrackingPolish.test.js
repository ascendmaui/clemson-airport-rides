import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  STILL_SEARCHING_COPY,
  STILL_SEARCHING_MS,
  SEARCH_PREVIEW_COPY,
  showSearchTheater,
} from '../packages/rides-native/liveTrip.js'
import { TESLA_FLEET_NOTICE } from '../packages/rides-native/tripTags.js'
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

test('web ride tiers and the active trip use the bookable catalog and the route line', () => {
  const tiers = readFileSync(new URL('../src/screens/RideTiers.jsx', import.meta.url), 'utf8')
  const requested = readFileSync(new URL('../src/screens/Requested.jsx', import.meta.url), 'utf8')
  assert.match(tiers, /bookableRideTiers\(/)
  assert.doesNotMatch(tiers, /id: 'xl'|id: 'pet'|id: 'tesla'|upsell === 'tesla'/)
  assert.match(requested, /activeTripRouteLine\(/)
  assert.match(requested, /eta=\{tripMissing \? null : etaLine\}/)
})

test('Tesla fleet notice stays honest about human driver', () => {
  assert.match(TESLA_FLEET_NOTICE, /driver|person|wheel|drives/i)
  assert.match(TESLA_FLEET_NOTICE, /no self-driving|not a live self-driving|robotaxi|Coming soon/i)
})
