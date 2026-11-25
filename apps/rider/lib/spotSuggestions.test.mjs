import assert from 'node:assert/strict'
import test from 'node:test'
import { neighborhoodsInGroup } from '../../../packages/rides-native/shared/carpool.js'
import { suggestSpots } from './spotSuggestions.ts'

test('suggestSpots ranks Clemson Stadium, College Avenue, a bar, a typo, and empty input', () => {
  const stadium = suggestSpots('Clemson Stadium')
  assert.equal(stadium[0]?.label, 'Memorial Stadium')
  assert.ok(stadium.length > 0)
  assert.ok(stadium.length <= 5)

  const college = suggestSpots('College Avenue')
  assert.equal(college[0]?.label, 'College Avenue')
  assert.equal(college[0]?.id, 'college-ave')
  assert.ok(college.length <= 5)

  const bar = suggestSpots('Tiger Town')
  assert.equal(bar[0]?.label, 'Tiger Town Tavern')
  assert.ok(bar.length <= 5)

  const typo = suggestSpots('Memoral Stadum')
  assert.equal(typo[0]?.label, 'Memorial Stadium')
  assert.ok(typo.length <= 5)

  assert.deepEqual(suggestSpots(''), [])
  assert.deepEqual(suggestSpots('   '), [])
})

test('suggestion dataset covers downtown bars, hot spots, and landmarks', () => {
  const bars = neighborhoodsInGroup('bars')
  assert.deepEqual(bars.map((bar) => bar.label), [
    'Tiger Town Tavern',
    "TD's",
    'The Esso Club',
    'Backstreets',
    "Nick's Tavern",
    'Study Hall',
    'Loose Change',
    '356',
    'Charleston Sports Pub',
    'ROAR',
    'The Wien',
  ])
  for (const bar of bars) {
    assert.equal(suggestSpots(bar.label)[0]?.id, bar.id, bar.label)
    assert.equal(Number.isFinite(bar.lat), true, bar.label)
    assert.equal(Number.isFinite(bar.lng), true, bar.label)
  }
  assert.equal(suggestSpots("TD's")[0]?.id, 'tds')
  assert.notEqual(suggestSpots("TD's")[0]?.id, 'tiger-town')
  assert.equal(suggestSpots('Tiger Town')[0]?.id, 'tiger-town')
  assert.equal(suggestSpots('ROAR')[0]?.id, 'roar')
  assert.equal(suggestSpots("It's Your Wiener")[0]?.id, 'the-wien')
  assert.equal(suggestSpots('Memorial Stadium')[0]?.id, 'memorial-stadium')
  assert.equal(suggestSpots('College Ave')[0]?.id, 'college-ave')
  assert.equal(suggestSpots('Grand Marc')[0]?.id, 'grand-marc')
  assert.equal(suggestSpots('GSP')[0]?.id, 'gsp')
})

test('suggestSpots merges geocoder or places hits and keeps the catalog copy', () => {
  // Not a catalog stop (Pendleton is one now), so the geocoder hit ranks first.
  const extra = [{ id: 'geo-old-stone', label: 'Old Stone Church Road', lat: 34.66, lng: -82.80 }]
  const hits = suggestSpots('Old Stone Church', extra)
  assert.equal(hits[0]?.id, 'geo-old-stone')
  assert.equal(hits[0]?.label, 'Old Stone Church Road')

  const once = suggestSpots('College Avenue', [{ id: 'geo-college', label: 'College Avenue', lat: 1, lng: 2 }])
  assert.equal(once.filter((row) => row.label === 'College Avenue').length, 1)
  assert.equal(once[0]?.id, 'college-ave')

  const crowded = suggestSpots('c', Array.from({ length: 8 }, (_, index) => ({
    id: `geo-${index}`,
    label: `Clemson Spot ${index}`,
    lat: 34.6,
    lng: -82.8,
  })))
  assert.equal(crowded.length, 5)
})
