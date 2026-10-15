import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { MARKER_SETTLE_MS, markerLookKey, tracksMarkerView } from '../apps/rider/lib/markerRedraw.ts'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('custom markers track only during the first-paint window', () => {
  assert.equal(tracksMarkerView(0), true)
  assert.equal(tracksMarkerView(MARKER_SETTLE_MS - 1), true)
  assert.equal(tracksMarkerView(MARKER_SETTLE_MS), false)
  assert.ok(MARKER_SETTLE_MS > 0 && MARKER_SETTLE_MS <= 1000)
  assert.equal(markerLookKey(['standard', null, 'car']), 'standard||car')
  assert.notEqual(markerLookKey(['orange']), markerLookKey(['purple']))
})

test('StillMarker freezes tracksViewChanges after the look settles', () => {
  const src = read('apps/rider/components/StillMarker.tsx')
  assert.match(src, /tracksViewChanges=\{tracking\}/)
  assert.match(src, /setTimeout\(\(\) => setTracking\(false\), MARKER_SETTLE_MS\)/)
  assert.match(src, /\[lookKey\]/)
})

test('rider map memoises custom marker arrays and does not track every frame', () => {
  const src = read('apps/rider/components/CampusMap.native.tsx')
  assert.match(src, /const theaterCars = useMemo\(/)
  assert.match(src, /const searchCars = useMemo\(/)
  assert.match(src, /const busyCars = useMemo\(/)
  assert.match(src, /const pinList = useMemo\(/)
  assert.match(src, /<StillMarker/)
  assert.match(src, /tracksViewChanges=\{false\}/)
  assert.doesNotMatch(src, /tracksViewChanges(?![=]\{false\})/)
  assert.match(src, /rotation=\{car\.heading\}/)
})
