import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {
  RIDER_LIST_WINDOW,
  friendScreenRows,
  pickerListRows,
  upcomingScheduleRows,
} from '../apps/rider/lib/virtualRows.ts'

const read = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('upcoming schedule rows drop canceled trips and keep ids', () => {
  const rows = upcomingScheduleRows([
    { id: 'a', status: 'scheduled' },
    { id: 'b', status: 'canceled' },
    { id: 'c', status: 'accepted' },
  ])
  assert.deepEqual(rows.map((row) => row.id), ['a', 'c'])
  assert.deepEqual(upcomingScheduleRows([]), [])
})

test('picker rows flatten groups and title a section only when there are two', () => {
  const one = pickerListRows([{ title: 'Online now', rows: [{ id: 'd1' }, { id: 'd2' }] }])
  assert.deepEqual(one.map((row) => row.kind), ['driver', 'driver'])
  assert.equal(one[0].key, 'driver:d1')
  const two = pickerListRows([
    { title: 'Preferred', rows: [{ id: 'p' }] },
    { title: 'Online now', rows: [{ id: 'o' }] },
  ])
  assert.deepEqual(two.map((row) => row.key), ['section:Preferred', 'driver:p', 'section:Online now', 'driver:o'])
  assert.equal(new Set(two.map((row) => row.key)).size, two.length)
})

test('friend screen rows keep friends, the ride-together bridge, then activity', () => {
  const rows = friendScreenRows([{ id: 'f1' }], [{ id: 'a1' }, { id: 'a2' }])
  assert.deepEqual(rows.map((row) => row.key), ['friend:f1', 'ride-together', 'activity-head', 'activity:a1', 'activity:a2'])
  const empty = friendScreenRows([], [])
  assert.deepEqual(empty.map((row) => row.kind), ['ride-together', 'activity-head'])
})

test('list window keeps first paint small', () => {
  assert.ok(RIDER_LIST_WINDOW.initialNumToRender <= 8)
  assert.ok(RIDER_LIST_WINDOW.windowSize >= 5)
})

test('schedule, history, friends, and pick-driver virtualize their lists', () => {
  const schedule = read('apps/rider/app/(tabs)/schedule.tsx')
  const history = read('apps/rider/app/history.tsx')
  const friends = read('apps/rider/app/(tabs)/friends.tsx')
  const pick = read('apps/rider/app/pick-driver.tsx')
  assert.match(schedule, /<FlatList/)
  assert.match(schedule, /data=\{upcoming\}/)
  assert.doesNotMatch(schedule, /status !== 'canceled'\)\.map/)
  assert.match(history, /<FlatList/)
  assert.match(history, /data=\{rows\}/)
  assert.doesNotMatch(history, /rows\.map\(/)
  assert.match(friends, /<FlatList/)
  assert.match(friends, /friendScreenRows/)
  assert.doesNotMatch(friends, /friends\.map\(/)
  assert.doesNotMatch(friends, /activity\.map\(/)
  assert.match(pick, /<Animated\.FlatList/)
  assert.match(pick, /pickerListRows/)
  assert.doesNotMatch(pick, /block\.rows\.map\(/)
  for (const src of [schedule, history, friends, pick]) {
    assert.match(src, /RIDER_LIST_WINDOW/)
  }
})
