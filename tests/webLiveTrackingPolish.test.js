import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import {
  STILL_SEARCHING_COPY,
  STILL_SEARCHING_MS,
  SEARCH_PREVIEW_COPY,
  showSearchTheater,
} from '../packages/rides-native/liveTrip.js'
import { depositSurfaceCopy } from '../packages/rides-native/riderMoney.js'

test('live tracking polish exports still-searching copy and search theater', () => {
  assert.equal(typeof STILL_SEARCHING_COPY, 'string')
  assert.match(STILL_SEARCHING_COPY, /Still looking/i)
  assert.ok(STILL_SEARCHING_MS >= 30000)
  assert.equal(showSearchTheater('searching'), true)
  assert.equal(showSearchTheater('accepted'), false)
  assert.match(SEARCH_PREVIEW_COPY, /preview/i)
})

test('confirm copy names an amount already paid and the remaining fare', () => {
  const copy = depositSurfaceCopy({ fareCents: 8000, depositCents: 2000, remainingCents: 6000 }, 'confirm')
  assert.match(copy, /Already paid \$20\.00/)
  assert.match(copy, /\$60\.00/)
  assert.doesNotMatch(copy, /25% deposit/)
})

test('web ride tiers and the active trip use the bookable catalog and the route line', () => {
  const tiers = readFileSync(new URL('../src/screens/RideTiers.jsx', import.meta.url), 'utf8')
  const requested = readFileSync(new URL('../src/screens/Requested.jsx', import.meta.url), 'utf8')
  assert.match(tiers, /useRideOptions/)
  assert.doesNotMatch(tiers, /id: 'xl'|id: 'pet'/)
  assert.match(requested, /followRouteLine\(/)
  assert.match(requested, /searchingRidePreview\(/)
  assert.match(requested, /searchPreview\s*\n\s*\? searchPreview\.route/)
  assert.match(requested, /search-wait__spinner/)
  assert.match(requested, /SEARCH_APPROX_WAIT_NOTE/)
  assert.match(requested, /fitRoute=\{routePath\.length > 1\}/)
  assert.match(requested, /staleEtaLine/)
  assert.match(requested, /driverPosition=\{preview \? null : driverPos\}/)
  assert.match(requested, /eta=\{tripMissing \? null : etaLine\}/)
})

test('tier screen offers a schedule path when no drivers are listed', () => {
  const tiers = readFileSync(new URL('../src/screens/RideTiers.jsx', import.meta.url), 'utf8')
  assert.match(tiers, /No drivers available right now|emptyMessage/)
  assert.match(tiers, /navigate\('schedule'\)/)
})
