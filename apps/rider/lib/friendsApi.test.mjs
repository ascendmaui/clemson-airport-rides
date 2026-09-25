import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

// Stub alias and native imports so this file never loads Expo or the network.
globalThis.fetch = async function forbiddenFetch() {
  throw new Error('offline test tried to call fetch')
}

const KEY = '__t1FriendsApi'
const FRIENDS_KEY = 'rider.friends'

function dataUrl(source) {
  return `data:text/javascript,${encodeURIComponent(source)}`
}

const storageUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  export const authStorage = {
    async getItem(name) {
      const state = globalThis[key]
      if (state.getError) throw state.getError
      return state.items.has(name) ? state.items.get(name) : null
    },
    async setItem(name, value) {
      const state = globalThis[key]
      if (state.setError) throw state.setError
      state.items.set(name, value)
    },
  }
`)

const supabaseUrl = dataUrl(`
  export let supabase = null
  export function __setSupabase(next) { supabase = next }
`)

const apiClientUrl = dataUrl(`
  const key = ${JSON.stringify(KEY)}
  export async function authedJson(client, path, options) {
    const state = globalThis[key]
    state.authedCalls.push({ client, path, options })
    if (state.authedError) throw state.authedError
    return state.authedResult
  }
`)

const PARENT = '/apps/rider/lib/friendsApi.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || ''
    if (!parent.includes(PARENT)) return nextResolve(specifier, context)
    if (specifier === '@/lib/storage') return { url: storageUrl, shortCircuit: true }
    if (specifier === '@/lib/supabase') return { url: supabaseUrl, shortCircuit: true }
    if (specifier === 'rides-native/apiClient.js' || specifier === 'rides-native/apiClient') {
      return { url: apiClientUrl, shortCircuit: true }
    }
    return nextResolve(specifier, context)
  },
})

function state() {
  return globalThis[KEY]
}

function networkError() {
  return new TypeError('Network request failed')
}

function timeoutError() {
  const error = new Error('Request timed out')
  error.name = 'TimeoutError'
  return error
}

function assertHuman(message) {
  assert.equal(typeof message, 'string')
  assert.notEqual(message.trim(), '')
  assert.equal(message.includes('[object Object]'), false)
  assert.equal(message.includes('undefined'), false)
  assert.equal(message.includes('\n'), false)
}

async function rejectionOf(promise) {
  try {
    await promise
  } catch (error) {
    return error
  }
  assert.fail('expected a rejection')
}

function supabaseClient(respond) {
  return {
    from(table) {
      const op = { table, filters: [] }
      let pending = null
      const run = () => {
        if (!pending) {
          state().ops.push(op)
          pending = Promise.resolve().then(() => respond(op))
        }
        return pending
      }
      const builder = {
        select(columns) {
          op.action = 'select'
          op.columns = columns
          return builder
        },
        update(payload) {
          op.action = 'update'
          op.payload = payload
          return builder
        },
        upsert(payload) {
          op.action = 'upsert'
          op.payload = payload
          return builder
        },
        ilike(column, value) {
          op.filters.push(['ilike', column, value])
          return builder
        },
        eq(column, value) {
          op.filters.push(['eq', column, value])
          return builder
        },
        order(column, options) {
          op.order = { column, options }
          return builder
        },
        limit(count) {
          op.limit = count
          return builder
        },
        maybeSingle() {
          op.tail = 'maybeSingle'
          return run()
        },
        then(onFulfilled, onRejected) {
          return run().then(onFulfilled, onRejected)
        },
      }
      return builder
    },
  }
}

let bridge = null

function reset() {
  globalThis[KEY] = {
    items: new Map(),
    getError: null,
    setError: null,
    authedCalls: [],
    authedError: null,
    authedResult: { id: 'ride-1', token: 'tok-1' },
    ops: [],
  }
  bridge?.__setSupabase(null)
}

function useClient(respond) {
  const client = supabaseClient(respond)
  bridge.__setSupabase(client)
  return client
}

const RAW_STACK = 'select failed\n    at from (supabase.js:10:4)'

test('friendsApi offline and error states', { concurrency: false }, async (t) => {
  reset()
  bridge = await import(supabaseUrl)
  const api = await import('./friendsApi.ts')
  t.beforeEach(reset)

  await t.test('exports the four friend helpers', () => {
    assert.equal(typeof api.loadSavedFriends, 'function')
    assert.equal(typeof api.addFriendByEmail, 'function')
    assert.equal(typeof api.listFriendActivity, 'function')
    assert.equal(typeof api.startRideTogether, 'function')
  })

  await t.test('loadSavedFriends keeps rows that have a name and email', async () => {
    state().items.set(FRIENDS_KEY, JSON.stringify([
      { id: '1', name: 'Ada', email: 'ada@clemson.edu' },
      { id: '2', name: 'No Email' },
      { id: '3', email: 'noname@clemson.edu' },
      { id: '4', name: 'Cy', email: 'cy@clemson.edu', extra: true },
      null,
      'x',
      { id: '5', name: 1, email: 'num@clemson.edu' },
    ]))
    assert.deepEqual(await api.loadSavedFriends(), [
      { id: '1', name: 'Ada', email: 'ada@clemson.edu' },
      { id: '4', name: 'Cy', email: 'cy@clemson.edu', extra: true },
    ])
  })

  await t.test('loadSavedFriends treats a missing or non-array cache as empty', async () => {
    assert.deepEqual(await api.loadSavedFriends(), [])
    for (const raw of ['', 'null', '42', 'true', '"friends"', '{"email":"a@b.com"}', '{', '[', 'not json']) {
      state().items.set(FRIENDS_KEY, raw)
      assert.deepEqual(await api.loadSavedFriends(), [], raw)
    }
  })

  await t.test('loadSavedFriends lets a throwing storage read reject', async () => {
    // BUG?: malformed JSON becomes []. A throwing getItem rejects, so the friends
    // screen shows the raw message — including "[object Object]" — instead of an empty list.
    state().getError = networkError()
    const offline = await rejectionOf(api.loadSavedFriends())
    assert.equal(offline instanceof TypeError, true)
    assert.equal(offline.message, 'Network request failed')

    state().getError = new Error('[object Object]')
    const ugly = await rejectionOf(api.loadSavedFriends())
    assert.equal(ugly.message, '[object Object]')
  })

  await t.test('addFriendByEmail normalizes the lookup, dedupes, and saves', async () => {
    state().items.set(FRIENDS_KEY, JSON.stringify([
      { id: 'bob', name: 'Bob', email: 'bob@clemson.edu' },
      { id: 'ada', name: 'Ada', email: 'old@clemson.edu' },
    ]))
    useClient(() => ({
      data: { id: 'ada', full_name: 'Ada Lovelace', email: 'Ada@Clemson.edu' },
      error: null,
    }))
    const saved = await api.addFriendByEmail('  Ada@Clemson.EDU  ')
    assert.deepEqual(saved, [
      { id: 'ada', name: 'Ada Lovelace', email: 'Ada@Clemson.edu' },
      { id: 'bob', name: 'Bob', email: 'bob@clemson.edu' },
    ])
    assert.deepEqual(JSON.parse(state().items.get(FRIENDS_KEY)), saved)
    assert.equal(state().ops.length, 1)
    assert.equal(state().ops[0].table, 'profiles')
    assert.equal(state().ops[0].tail, 'maybeSingle')
    assert.deepEqual(state().ops[0].filters, [['ilike', 'email', 'ada@clemson.edu']])
  })

  await t.test('addFriendByEmail keeps the twenty most recent friends', async () => {
    const existing = Array.from({ length: 20 }, (_, index) => ({
      id: `f-${index}`,
      name: `Friend ${index}`,
      email: `f${index}@clemson.edu`,
    }))
    state().items.set(FRIENDS_KEY, JSON.stringify(existing))
    useClient(() => ({
      data: { id: 'new', full_name: 'New', email: 'new@clemson.edu' },
      error: null,
    }))
    const saved = await api.addFriendByEmail('new@clemson.edu')
    assert.equal(saved.length, 20)
    assert.equal(saved[0].id, 'new')
    assert.equal(saved.some((row) => row.id === 'f-19'), false)
    assert.equal(saved[19].id, 'f-18')
  })

  await t.test('addFriendByEmail rejects text that is not an email', async () => {
    useClient(() => {
      throw new Error('should not query')
    })
    for (const email of ['', '   ', 'not-an-email', 'ada.clemson.edu']) {
      const caught = await rejectionOf(api.addFriendByEmail(email))
      assert.equal(caught.message, 'Enter an email address.')
      assertHuman(caught.message)
    }
    assert.equal(state().ops.length, 0)
  })

  await t.test('addFriendByEmail reports a missing supabase client', async () => {
    const caught = await rejectionOf(api.addFriendByEmail('ada@clemson.edu'))
    assert.equal(caught.message, 'Supabase is not configured')
    assertHuman(caught.message)
    assert.equal(state().items.has(FRIENDS_KEY), false)
  })

  await t.test('addFriendByEmail says when no profile matches', async () => {
    useClient(() => ({ data: null, error: null }))
    const caught = await rejectionOf(api.addFriendByEmail('missing@clemson.edu'))
    assert.equal(caught.message, 'No rider with that email yet.')
    assertHuman(caught.message)
    assert.equal(state().items.has(FRIENDS_KEY), false)
  })

  await t.test('addFriendByEmail fills a missing name from the email, then Tiger', async () => {
    useClient(() => ({ data: { id: 7, full_name: '', email: null }, error: null }))
    const tiger = await api.addFriendByEmail('Tiger@Clemson.edu')
    assert.deepEqual(tiger, [{ id: '7', name: 'Tiger', email: 'tiger@clemson.edu' }])

    state().items.clear()
    useClient(() => ({ data: { id: 'bee', full_name: null, email: 'Bee@Clemson.edu' }, error: null }))
    const bee = await api.addFriendByEmail('bee@clemson.edu')
    assert.deepEqual(bee, [{ id: 'bee', name: 'Bee@Clemson.edu', email: 'Bee@Clemson.edu' }])
  })

  await t.test('addFriendByEmail surfaces a readable supabase error', async () => {
    useClient(() => ({ data: { id: 'ada' }, error: { message: 'permission denied for table profiles' } }))
    const caught = await rejectionOf(api.addFriendByEmail('ada@clemson.edu'))
    assert.equal(caught.message, 'permission denied for table profiles')
    assertHuman(caught.message)
    assert.equal(state().items.has(FRIENDS_KEY), false)
  })

  await t.test('addFriendByEmail copies a non-readable supabase error message', async () => {
    // BUG?: error.message is passed to Error() unchanged. A missing message becomes "",
    // null becomes "null", an object becomes "[object Object]", and a stack is shown whole.
    const cases = [
      [{}, ''],
      [{ message: null }, 'null'],
      [{ message: { code: '42501' } }, '[object Object]'],
      [{ message: RAW_STACK }, RAW_STACK],
    ]
    for (const [supabaseError, expected] of cases) {
      useClient(() => ({ data: null, error: supabaseError }))
      const caught = await rejectionOf(api.addFriendByEmail('ada@clemson.edu'))
      assert.equal(caught.message, expected)
    }
  })

  await t.test('addFriendByEmail propagates a network failure and a timeout', async () => {
    for (const error of [networkError(), timeoutError()]) {
      useClient(() => {
        throw error
      })
      const caught = await rejectionOf(api.addFriendByEmail('ada@clemson.edu'))
      assert.equal(caught, error)
      assertHuman(caught.message)
    }
  })

  await t.test('addFriendByEmail replaces a malformed cache with the new friend', async () => {
    state().items.set(FRIENDS_KEY, '{')
    useClient(() => ({
      data: { id: 'ada', full_name: 'Ada', email: 'ada@clemson.edu' },
      error: null,
    }))
    const saved = await api.addFriendByEmail('ada@clemson.edu')
    assert.deepEqual(saved, [{ id: 'ada', name: 'Ada', email: 'ada@clemson.edu' }])
    assert.deepEqual(JSON.parse(state().items.get(FRIENDS_KEY)), saved)
  })

  await t.test('addFriendByEmail aborts when the saved-friend read throws', async () => {
    // BUG?: a malformed cache is treated as []. A throwing read rejects after the
    // profile lookup succeeded, so the new friend is not saved.
    const raw = JSON.stringify([{ id: 'bob', name: 'Bob', email: 'bob@clemson.edu' }])
    state().items.set(FRIENDS_KEY, raw)
    state().getError = new Error('storage read failed')
    useClient(() => ({
      data: { id: 'ada', full_name: 'Ada', email: 'ada@clemson.edu' },
      error: null,
    }))
    const caught = await rejectionOf(api.addFriendByEmail('ada@clemson.edu'))
    assert.equal(caught.message, 'storage read failed')
    assert.equal(state().items.get(FRIENDS_KEY), raw)
  })

  await t.test('addFriendByEmail leaves the cache unchanged when the write throws', async () => {
    const raw = JSON.stringify([{ id: 'bob', name: 'Bob', email: 'bob@clemson.edu' }])
    state().items.set(FRIENDS_KEY, raw)
    state().setError = new Error('storage write failed')
    useClient(() => ({
      data: { id: 'ada', full_name: 'Ada', email: 'ada@clemson.edu' },
      error: null,
    }))
    const caught = await rejectionOf(api.addFriendByEmail('ada@clemson.edu'))
    assert.equal(caught.message, 'storage write failed')
    assertHuman(caught.message)
    assert.equal(state().items.get(FRIENDS_KEY), raw)
  })

  await t.test('listFriendActivity returns rows and leaves fare cents untouched', async () => {
    const rows = [
      {
        id: 'a',
        token: 'tok',
        status: 'open',
        kind: 'friends',
        split_mode: 'even',
        total_fare_cents: 2599,
        created_at: '2026-09-25T00:00:00Z',
      },
      {
        id: 'b',
        token: null,
        status: 'canceled',
        kind: 'friends',
        split_mode: 'by_distance',
        total_fare_cents: 0,
        created_at: '2026-09-24T00:00:00Z',
      },
    ]
    useClient(() => ({ data: rows, error: null }))
    assert.deepEqual(await api.listFriendActivity('user-1'), rows)
    assert.equal(state().ops[0].table, 'friend_rides')
    assert.deepEqual(state().ops[0].filters, [['eq', 'organizer_id', 'user-1']])
    assert.deepEqual(state().ops[0].order, { column: 'created_at', options: { ascending: false } })
    assert.equal(state().ops[0].limit, 8)
  })

  await t.test('listFriendActivity is an empty list when supabase or the rows are missing', async () => {
    assert.deepEqual(await api.listFriendActivity('user-1'), [])
    for (const data of [null, undefined]) {
      useClient(() => ({ data, error: null }))
      assert.deepEqual(await api.listFriendActivity('user-1'), [])
    }
  })

  await t.test('listFriendActivity surfaces a readable supabase error', async () => {
    useClient(() => ({ data: [{ id: 'hidden' }], error: { message: 'permission denied for table friend_rides' } }))
    const caught = await rejectionOf(api.listFriendActivity('user-1'))
    assert.equal(caught.message, 'permission denied for table friend_rides')
    assertHuman(caught.message)
  })

  await t.test('listFriendActivity copies a non-readable supabase error message', async () => {
    // BUG?: error.message is passed to Error() unchanged. A missing message becomes "",
    // null becomes "null", an object becomes "[object Object]", and a stack is shown whole.
    const cases = [
      [{}, ''],
      [{ message: null }, 'null'],
      [{ message: { code: '42501' } }, '[object Object]'],
      [{ message: RAW_STACK }, RAW_STACK],
    ]
    for (const [supabaseError, expected] of cases) {
      useClient(() => ({ data: [{ id: 'hidden' }], error: supabaseError }))
      const caught = await rejectionOf(api.listFriendActivity('user-1'))
      assert.equal(caught.message, expected)
    }
  })

  await t.test('listFriendActivity propagates a network failure and a timeout', async () => {
    for (const error of [networkError(), timeoutError()]) {
      useClient(() => {
        throw error
      })
      const caught = await rejectionOf(api.listFriendActivity('user-1'))
      assert.equal(caught, error)
      assertHuman(caught.message)
    }
  })

  await t.test('startRideTogether posts the friend ride and returns the api body', async () => {
    const client = { tag: 'configured' }
    bridge.__setSupabase(client)
    const pickup = { label: 'White C', lat: 34.68, lng: -82.84 }
    const dropoff = { label: 'GSP', lat: 34.89, lng: -82.22 }
    const created = await api.startRideTogether({
      displayName: 'Ada',
      pickup,
      dropoff,
      splitMode: 'by_distance',
      partyType: 'tailgate',
    })
    assert.deepEqual(created, { id: 'ride-1', token: 'tok-1' })
    assert.deepEqual(state().authedCalls, [{
      client,
      path: '/api/friend-rides?action=create',
      options: {
        method: 'POST',
        body: {
          displayName: 'Ada',
          pickup,
          dropoff,
          splitMode: 'by_distance',
          kind: 'friends',
          partyType: 'tailgate',
        },
      },
    }])
    assert.equal(state().items.size, 0)
  })

  await t.test('startRideTogether still calls the api when supabase is null', async () => {
    // BUG?: a null supabase client still calls authedJson. addFriendByEmail throws
    // "Supabase is not configured" and listFriendActivity returns [] without a request.
    const created = await api.startRideTogether({
      displayName: 'Ada',
      pickup: { label: 'White C', lat: 1, lng: 2 },
      dropoff: { label: 'GSP', lat: 3, lng: 4 },
      splitMode: 'even',
      partyType: 'carpool',
    })
    assert.equal(created.token, 'tok-1')
    assert.equal(state().authedCalls[0].client, null)
    assert.equal(state().authedCalls[0].path, '/api/friend-rides?action=create')
  })

  await t.test('startRideTogether propagates authedJson network, timeout, and raw errors', async () => {
    const pickup = { label: 'White C', lat: 1, lng: 2 }
    const dropoff = { label: 'GSP', lat: 3, lng: 4 }
    const input = {
      displayName: 'Ada',
      pickup,
      dropoff,
      splitMode: 'even',
      partyType: 'carpool',
    }
    for (const error of [networkError(), timeoutError()]) {
      state().authedError = error
      const caught = await rejectionOf(api.startRideTogether(input))
      assert.equal(caught, error)
      assertHuman(caught.message)
    }

    // BUG?: a non-readable authedJson rejection is forwarded unchanged, so the friends
    // screen can show "[object Object]" or a stack.
    state().authedError = new Error('[object Object]')
    const ugly = await rejectionOf(api.startRideTogether(input))
    assert.equal(ugly.message, '[object Object]')

    state().authedError = new Error(RAW_STACK)
    const stacked = await rejectionOf(api.startRideTogether(input))
    assert.equal(stacked.message, RAW_STACK)
  })
})
