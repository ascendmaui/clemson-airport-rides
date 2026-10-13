import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { RESUMABLE_STATUSES, pickResumableTrip, resumeAnnouncement, shouldAutoResume } from '../packages/rides-native/tripResume.js'

const NOW = new Date('2026-10-09T15:00:00Z')
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')

test('picks the most advanced live trip that is due now', () => {
  const rows = [
    { id: 'a', status: 'accepted', accepted_at: '2026-10-09T14:58:00Z' },
    { id: 'b', status: 'in_progress', accepted_at: '2026-10-09T14:30:00Z' },
    { id: 'c', status: 'arrived', accepted_at: '2026-10-09T14:50:00Z' },
  ]
  assert.equal(pickResumableTrip(rows, NOW).id, 'b')
  assert.equal(pickResumableTrip(rows.slice(0, 1), NOW).id, 'a')
})

test('skips finished, future-scheduled, and stale never-started trips', () => {
  assert.equal(pickResumableTrip([{ id: 'x', status: 'completed' }], NOW), null)
  assert.equal(pickResumableTrip([{ id: 'x', status: 'accepted', pickup_at: '2026-10-10T15:00:00Z', accepted_at: '2026-10-09T14:00:00Z' }], NOW), null)
  assert.equal(pickResumableTrip([{ id: 'x', status: 'accepted', accepted_at: '2026-10-08T15:00:00Z' }], NOW), null)
  assert.equal(pickResumableTrip([{ id: 'x', status: 'in_progress', accepted_at: '2026-10-08T15:00:00Z' }], NOW).id, 'x')
  assert.equal(pickResumableTrip(null, NOW), null)
  assert.deepEqual([...RESUMABLE_STATUSES], ['accepted', 'arriving', 'arrived', 'in_progress'])
})

test('only jumps from Home, once per trip per launch', () => {
  const handled = new Set()
  assert.equal(shouldAutoResume({ tripId: 't', pathname: '/', handled }), true)
  assert.equal(shouldAutoResume({ tripId: 't', pathname: '/trip', handled }), false)
  assert.equal(shouldAutoResume({ tripId: 't', pathname: '/settings/navigation', handled }), false)
  assert.equal(shouldAutoResume({ tripId: 't', pathname: '/sign-in', handled }), false)
  handled.add('t')
  assert.equal(shouldAutoResume({ tripId: 't', pathname: '/', handled }), false)
  assert.equal(shouldAutoResume({ tripId: null, pathname: '/' }), false)
  assert.equal(resumeAnnouncement('in_progress'), 'Resuming your trip to drop-off')
})

test('driver layout mounts the resume bridge after the stack', () => {
  const layout = read('../apps/driver/app/_layout.tsx')
  assert.match(layout, /<ThemedStack \/>\s*<ActiveTripResume \/>/)
  const bridge = read('../apps/driver/components/ActiveTripResume.tsx')
  assert.match(bridge, /\.eq\('driver_id', user\.id\)/)
  assert.match(bridge, /router\.push\(\{ pathname: '\/trip', params: \{ id: trip\.id \} \}\)/)
  assert.match(bridge, /const handled = new Set<string>\(\)/)
})
