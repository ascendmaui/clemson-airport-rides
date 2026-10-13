import assert from 'node:assert/strict'
import test from 'node:test'
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

test('suggestSpots merges geocoder or places hits and keeps the catalog copy', () => {
  const extra = [{ id: 'geo-pendleton', label: 'Pendleton Road', lat: 34.65, lng: -82.78 }]
  const hits = suggestSpots('Pendleton', extra)
  assert.equal(hits[0]?.id, 'geo-pendleton')
  assert.equal(hits[0]?.label, 'Pendleton Road')

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
