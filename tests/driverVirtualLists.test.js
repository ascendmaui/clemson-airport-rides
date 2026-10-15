import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { DRIVER_LIST_WINDOW, dayRows } from '../apps/driver/lib/virtualRows.ts'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('dayRows flattens groups into day headers then items with unique stable keys', () => {
  const rows = dayRows([
    ['2026-10-14', [{ id: 'a' }, { id: 'b' }]],
    ['2026-10-13', []],
    ['2026-10-12', [{ id: 'c' }]],
  ])
  assert.deepEqual(rows.map((r) => r.key), ['day:2026-10-14', 'item:a', 'item:b', 'day:2026-10-12', 'item:c'])
  assert.equal(rows[0].first, true)
  assert.equal(rows[3].first, false)
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length)
  assert.deepEqual(dayRows([]), [])
})

test('list window keeps first paint small', () => {
  assert.ok(DRIVER_LIST_WINDOW.initialNumToRender <= 8)
  assert.ok(DRIVER_LIST_WINDOW.windowSize >= 5)
})

test('queue renders offers through a FlatList, not a mapped ScrollView', () => {
  const src = read('apps/driver/app/queue.tsx')
  assert.match(src, /<FlatList\s+data=\{canSeeOffers \? shown : \[\]\}/)
  assert.match(src, /keyExtractor=\{\(card: DriverCard\) => card\.id\}/)
  assert.doesNotMatch(src, /shown\.map\(/)
  assert.match(src, /refreshControl=\{\s*<RefreshControl/)
})

test('earnings activity is virtualized inside a non-scrolling StackPage', () => {
  const src = read('apps/driver/app/earnings-activity.tsx')
  assert.match(src, /scroll=\{false\}/)
  assert.match(src, /<FlatList\s+data=\{rows\}/)
  assert.doesNotMatch(src, /groups\.map\(/)
  const shell = read('apps/driver/components/shell.tsx')
  assert.match(shell, /scroll = true,/)
  assert.match(shell, /\{scroll \? \(/)
})
