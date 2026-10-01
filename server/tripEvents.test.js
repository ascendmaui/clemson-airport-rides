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

test('insertTripEvent labels a missing kind as unknown', async () => {
  const logged = []
  const original = console.error
  console.error = (...args) => { logged.push(args.map(String).join(' ')) }
  try {
    const { error } = await insertTripEvent(null, { trip_id: 't1' })
    assert.match(error.message, /supabase client required/)
    assert.equal(logged.some((line) => line.includes('[trip_events]') && line.includes('unknown')), true)
  } finally {
    console.error = original
  }
})

test('insertTripEvent stringifies an insert error that has no message', async () => {
  const logged = []
  const original = console.error
  console.error = (...args) => { logged.push(args.map(String).join(' ')) }
  try {
    const { data, error } = await insertTripEvent(fakeSb({ insertError: { code: 'XX000' } }), {
      trip_id: 'trip-1',
      kind: 'accepted',
      payload: {},
    })
    assert.equal(data, null)
    assert.equal(error.code, 'XX000')
    assert.equal(logged.some((line) => line.includes('[trip_events]') && line.includes('accepted') && line.includes('[object Object]')), true)
  } finally {
    console.error = original
  }
})

test('insertTripEvent propagates when insert rejects', async () => {
  const sb = {
    from(table) {
      assert.equal(table, 'trip_events')
      return {
        insert() {
          return Promise.reject(new Error('network down'))
        },
      }
    },
  }
  await assert.rejects(
    () => insertTripEvent(sb, { trip_id: 'trip-1', kind: 'accepted', payload: {} }),
    /network down/,
  )
})
