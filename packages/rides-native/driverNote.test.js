import assert from 'node:assert/strict'
import test from 'node:test'
import { rideRequestNote } from './driverNote.js'

test('ride request note payload trims into note and nullable rider_note', () => {
  assert.deepEqual(rideRequestNote('  Near the orange gates, purple hoodie  '), {
    note: 'Near the orange gates, purple hoodie',
    rider_note: 'Near the orange gates, purple hoodie',
  })
  assert.deepEqual(rideRequestNote('line\nbreak'), {
    note: 'line break',
    rider_note: 'line break',
  })
  assert.deepEqual(rideRequestNote('   '), { note: '', rider_note: null })
  assert.deepEqual(rideRequestNote(null), { note: '', rider_note: null })
  const long = rideRequestNote('n'.repeat(400))
  assert.equal(long.note.length, 280)
  assert.equal(long.rider_note.length, 280)
})
