import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { MARKER_SETTLE_MS, markerLookKey } from '../apps/driver/lib/markerRedraw.ts'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8')

test('marker look key changes with look, not with position', () => {
  assert.equal(markerLookKey(['#F56600', '#522D80', null, 'car']), '#F56600|#522D80||car')
  assert.notEqual(markerLookKey(['#F56600', 'ring']), markerLookKey(['#F56600', 'stripe']))
  assert.ok(MARKER_SETTLE_MS > 0 && MARKER_SETTLE_MS <= 1000)
})

test('StillMarker tracks view changes only for a window after the look changes', () => {
  const src = read('apps/driver/components/StillMarker.tsx')
  assert.match(src, /tracksViewChanges=\{tracking\}/)
  assert.match(src, /setTimeout\(\(\) => setTracking\(false\), MARKER_SETTLE_MS\)/)
  assert.match(src, /\[lookKey\]/)
})

test('no driver map marker redraws every frame on Android', () => {
  for (const file of ['apps/driver/components/CampusMap.native.tsx', 'apps/driver/components/OfferRouteMap.native.tsx']) {
    const src = read(file)
    const markers = src.match(/<Marker\b[\s\S]*?(\/>|>)/g) || []
    for (const tag of markers) assert.match(tag, /tracksViewChanges=\{false\}/, `${file}: ${tag.slice(0, 80)}`)
  }
  const map = read('apps/driver/components/CampusMap.native.tsx')
  assert.match(map, /<StillMarker[\s\S]*?lookKey=/)
  assert.match(map, /const markers = useMemo\(/)
  assert.match(map, /<Glyph name=\{pin\.marker\.glyph\}/)
})
