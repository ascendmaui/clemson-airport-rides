import assert from 'node:assert/strict'
import test from 'node:test'
import { insertTripEvent } from './tripEvents.js'

function fakeSb({ insertError = null, capture = [] } = {}) {
  return {
    from(table) {
      assert.equal(table, 'trip_events')
      return {
        insert(row) {
          capture.push(row)
          return Promise.resolve({
            data: insertError ? null : row,
            error: insertError,
          })
        },
      }
    },
  }
}

test('insertTripEvent writes trip_id, kind, and payload', async () => {
  const capture = []
  const { data, error } = await insertTripEvent(fakeSb({ capture }), {
    trip_id: 'trip-1',
    kind: 'scheduled',
    payload: { purpose: 'airport' },
  })
  assert.equal(error, null)
  assert.deepEqual(data, {
    trip_id: 'trip-1',
    kind: 'scheduled',
    payload: { purpose: 'airport' },
  })
  assert.equal(capture.length, 1)
})

test('insertTripEvent logs and returns error when insert fails', async () => {
  const logged = []
  const original = console.error
  console.error = (...args) => { logged.push(args.map(String).join(' ')) }
  try {
    const { data, error } = await insertTripEvent(fakeSb({
      insertError: { message: 'insert or update on table "trip_events" violates foreign key' },
    }), {
      trip_id: 'trip-missing',
      kind: 'scheduled',
      payload: {},
    })
    assert.equal(data, null)
    assert.match(error.message, /foreign key/)
    assert.equal(logged.some((line) => line.includes('[trip_events]') && line.includes('scheduled') && line.includes('foreign key')), true)
  } finally {
    console.error = original
  }
})

test('insertTripEvent logs when supabase client is missing', async () => {
  const logged = []
  const original = console.error
  console.error = (...args) => { logged.push(args.map(String).join(' ')) }
  try {
    const { error } = await insertTripEvent(null, { trip_id: 't1', kind: 'accepted' })
    assert.match(error.message, /supabase client required/)
    assert.equal(logged.some((line) => line.includes('[trip_events]')), true)
  } finally {
    console.error = original
  }
})

test('insertTripEvent logs when trip_id is missing', async () => {
  const logged = []
  const original = console.error
  console.error = (...args) => { logged.push(args.map(String).join(' ')) }
  try {
    const { error } = await insertTripEvent(fakeSb(), { kind: 'accepted', payload: {} })
    assert.match(error.message, /trip_id required/)
    assert.equal(logged.some((line) => line.includes('[trip_events]')), true)
  } finally {
    console.error = original
  }
})
