import assert from 'node:assert/strict'
import test from 'node:test'
import { DEMO_FLEET } from './demoFleet.js'
import { favoriteIdsForMatching, isPreviewDriverId, orderDriversForRider } from './riderFavorites.js'

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

test('preview cars never qualify as favorites', () => {
  for (const car of DEMO_FLEET) {
    assert.equal(isPreviewDriverId(car.id), true)
    assert.equal(car.bookable, false)
  }
  assert.equal(isPreviewDriverId('sim-busy-1'), true)
  assert.deepEqual(favoriteIdsForMatching([
    ' demo-marcus ',
    'sim-busy-9',
    A,
    A,
    'not-a-uuid',
    B,
  ]), [A, B])
})

test('matching offers preferred drivers, then other favorites, and never promotes a preview car', () => {
  const drivers = [
    { id: A, name: 'John' },
    { id: 'demo-marcus', name: 'Preview' },
    { id: B, name: 'Other' },
    { id: C, name: 'Kim' },
  ]
  const ordered = orderDriversForRider(drivers, {
    preferredIds: [B, 'demo-marcus'],
    favoriteIds: [C, 'demo-brooke', A],
  })
  assert.deepEqual(ordered.map((driver) => driver.id), [B, A, C, 'demo-marcus'])
})
