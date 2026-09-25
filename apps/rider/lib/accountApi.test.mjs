import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

// Stub alias imports so this file never loads Expo, Supabase, or the network.
globalThis.fetch = async function forbiddenFetch() {
  throw new Error('offline test tried to call fetch')
}

const KEY = '__t1AccountApi'

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

const PARENT = '/apps/rider/lib/accountApi.ts'

registerHooks({
  resolve(specifier, context, nextResolve) {
    const parent = context.parentURL || ''
    if (!parent.includes(PARENT)) return nextResolve(specifier, context)
    if (specifier === '@/lib/storage') return { url: storageUrl, shortCircuit: true }
    if (specifier === '@/lib/supabase') return { url: supabaseUrl, shortCircuit: true }
    return nextResolve(specifier, context)
  },
})

function state() {
  return globalThis[KEY]
}

function prefsKey(userId) {
  return `rider.notif.${userId}`
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

function assertIso(value) {
  assert.match(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/)
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
    ops: [],
  }
  bridge?.__setSupabase(null)
}

function useClient(respond) {
  const client = supabaseClient(respond)
  bridge.__setSupabase(client)
  return client
}

const RAW_STACK = 'update failed\n    at from (supabase.js:12:4)'
const LOCAL_PREFS = {
  ride: false,
  billing: true,
  friends: true,
  promotions: true,
  system: true,
}

test('accountApi offline and error states', { concurrency: false }, async (t) => {
  reset()
  bridge = await import(supabaseUrl)
  const api = await import('./accountApi.ts')
  t.beforeEach(reset)

  await t.test('exports the four account helpers', () => {
    assert.equal(typeof api.loadAccount, 'function')
    assert.equal(typeof api.saveProfile, 'function')
    assert.equal(typeof api.saveNotificationPrefs, 'function')
    assert.equal(typeof api.listHistory, 'function')
  })

  await t.test('loadAccount maps a profile and normalizes server notification prefs', async () => {
    state().items.set(prefsKey('user-1'), JSON.stringify({ ride: true, promotions: false }))
    useClient((op) => {
      assert.equal(op.table, 'profiles')
      assert.equal(op.tail, 'maybeSingle')
      assert.deepEqual(op.filters, [['eq', 'id', 'user-1']])
      return {
        data: {
          full_name: 'Ada Lovelace',
          bio: 'Campus',
          email: 'ada@clemson.edu',
          student_verified_at: '2026-01-02T00:00:00Z',
          favorite_spots: ['White C', 3, 'Library', 'Tillman', 'ASC', 'Snow', 'Extra', 'Seventh'],
          notification_prefs: { promotions: true, ride: false },
          stripe_card_brand: 'visa',
          stripe_card_last4: '4242',
          rating_avg: 0,
          rating_count: 0,
        },
        error: null,
      }
    })
    const result = await api.loadAccount('user-1')
    assert.equal(result.error, null)
    assert.deepEqual(result.profile, {
      full_name: 'Ada Lovelace',
      bio: 'Campus',
      email: 'ada@clemson.edu',
      student_verified_at: '2026-01-02T00:00:00Z',
      favorite_spots: ['White C', 'Library', 'Tillman', 'ASC', 'Snow', 'Extra'],
      notification_prefs: { promotions: true, ride: false },
      stripe_card_brand: 'visa',
      stripe_card_last4: '4242',
      rating_avg: 0,
      rating_count: 0,
    })
    assert.deepEqual(result.prefs, {
      ride: false,
      billing: true,
      friends: true,
      promotions: true,
      system: true,
    })
    assert.notEqual(result.prefs, api.DEFAULT_NOTIFICATION_PREFS)
  })

  await t.test('loadAccount uses on-device prefs when the profile has none', async () => {
    state().items.set(prefsKey('user-1'), JSON.stringify({ ride: false, promotions: true }))
    useClient(() => ({
      data: {
        full_name: null,
        bio: undefined,
        email: undefined,
        student_verified_at: undefined,
        favorite_spots: null,
        notification_prefs: null,
        stripe_card_brand: undefined,
        stripe_card_last4: null,
        rating_avg: null,
        rating_count: undefined,
      },
      error: null,
    }))
    const result = await api.loadAccount('user-1')
    assert.equal(result.error, null)
    assert.deepEqual(result.profile, {
      full_name: null,
      bio: null,
      email: null,
      student_verified_at: null,
      favorite_spots: [],
      notification_prefs: null,
      stripe_card_brand: null,
      stripe_card_last4: null,
      rating_avg: null,
      rating_count: null,
    })
    assert.deepEqual(result.prefs, LOCAL_PREFS)
  })

  await t.test('loadAccount treats a missing profile row as empty and keeps local prefs', async () => {
    state().items.set(prefsKey('user-1'), JSON.stringify({ promotions: true }))
    useClient(() => ({ data: null, error: null }))
    const result = await api.loadAccount('user-1')
    assert.equal(result.profile, null)
    assert.equal(result.error, null)
    assert.equal(result.prefs.promotions, true)
    assert.equal(result.prefs.ride, true)
  })

  await t.test('an empty server prefs object replaces the on-device cache', async () => {
    state().items.set(prefsKey('user-1'), JSON.stringify({ ride: false, promotions: true }))
    useClient(() => ({
      data: { notification_prefs: {}, full_name: 'Ada' },
      error: null,
    }))
    const result = await api.loadAccount('user-1')
    assert.deepEqual(result.prefs, {
      ride: true,
      billing: true,
      friends: true,
      promotions: false,
      system: true,
    })
  })

  await t.test('loadAccount without a saved blob returns the shared default object', async () => {
    // BUG?: the offline fallback returns the live DEFAULT_NOTIFICATION_PREFS object.
    // A caller that mutates .prefs changes the defaults for every later load.
    const result = await api.loadAccount('user-1')
    assert.equal(result.profile, null)
    assert.equal(result.error, 'Supabase is not configured')
    assert.equal(result.prefs, api.DEFAULT_NOTIFICATION_PREFS)
    assertHuman(result.error)
  })

  await t.test('loadAccount falls back to defaults when the prefs blob is malformed', async () => {
    state().items.set(prefsKey('user-1'), '{')
    const result = await api.loadAccount('user-1')
    assert.equal(result.profile, null)
    assert.equal(result.error, 'Supabase is not configured')
    assert.equal(result.prefs, api.DEFAULT_NOTIFICATION_PREFS)
    assertHuman(result.error)
  })

  await t.test('loadAccount keeps custom on-device prefs when supabase is null', async () => {
    state().items.set(prefsKey('user-9'), JSON.stringify({ ride: false, promotions: true }))
    const result = await api.loadAccount('user-9')
    assert.equal(result.profile, null)
    assert.equal(result.error, 'Supabase is not configured')
    assert.deepEqual(result.prefs, LOCAL_PREFS)
    assertHuman(result.error)
    assert.equal(state().ops.length, 0)
  })

  await t.test('loadAccount returns local prefs and a readable supabase error', async () => {
    state().items.set(prefsKey('user-1'), JSON.stringify({ ride: false, promotions: true }))
    useClient(() => ({ data: { full_name: 'Ada' }, error: { message: 'permission denied for table profiles' } }))
    const result = await api.loadAccount('user-1')
    assert.equal(result.profile, null)
    assert.equal(result.error, 'permission denied for table profiles')
    assert.deepEqual(result.prefs, LOCAL_PREFS)
    assertHuman(result.error)
  })

  await t.test('loadAccount returns a non-readable supabase error as-is', async () => {
    // BUG?: error.message is returned with no fallback. undefined, null, and "" are
    // falsy, so the account screen treats them as success. An object or a stack is shown raw.
    state().items.set(prefsKey('user-1'), JSON.stringify({ ride: false, promotions: true }))
    const cases = [
      [{}, undefined],
      [{ message: null }, null],
      [{ message: '' }, ''],
      [{ message: { code: '42501' } }, { code: '42501' }],
      [{ message: RAW_STACK }, RAW_STACK],
    ]
    for (const [supabaseError, expected] of cases) {
      useClient(() => ({ data: { full_name: 'Ada' }, error: supabaseError }))
      const result = await api.loadAccount('user-1')
      assert.equal(result.profile, null)
      assert.deepEqual(result.prefs, LOCAL_PREFS)
      if (expected && typeof expected === 'object') assert.equal(result.error, supabaseError.message)
      else assert.equal(result.error, expected)
    }
  })

  await t.test('loadAccount returns on-device prefs when the profile fetch throws', async () => {
    state().items.set(prefsKey('user-1'), JSON.stringify({ ride: false, promotions: true }))
    const offlineCopy = 'Could not load your account. Check your connection and try again.'
    for (const error of [networkError(), timeoutError(), new Error('[object Object]'), new Error(RAW_STACK)]) {
      useClient(() => {
        throw error
      })
      const result = await api.loadAccount('user-1')
      assert.equal(result.profile, null)
      assert.equal(result.error, offlineCopy)
      assertHuman(result.error)
      assert.deepEqual(result.prefs, LOCAL_PREFS)
      assert.equal(state().items.get(prefsKey('user-1')), JSON.stringify({ ride: false, promotions: true }))
    }
  })

  await t.test('loadAccount lets a throwing storage read reject', async () => {
    // BUG?: malformed prefs JSON falls back to defaults. A throwing getItem rejects
    // before the supabase-null result, including when the message is "[object Object]".
    state().getError = networkError()
    const offline = await rejectionOf(api.loadAccount('user-1'))
    assert.equal(offline instanceof TypeError, true)
    assert.equal(offline.message, 'Network request failed')

    state().getError = new Error('[object Object]')
    const ugly = await rejectionOf(api.loadAccount('user-1'))
    assert.equal(ugly.message, '[object Object]')
  })

  await t.test('saveProfile trims text, clears blanks, and caps spots at six', async () => {
    const spots = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    let payload = null
    useClient((op) => {
      payload = op.payload
      assert.equal(op.table, 'profiles')
      assert.equal(op.action, 'update')
      assert.deepEqual(op.filters, [['eq', 'id', 'user-1']])
      return { error: null }
    })
    const result = await api.saveProfile('user-1', {
      full_name: '  Ada Lovelace  ',
      bio: '   ',
      favorite_spots: spots,
    })
    assert.equal(result, undefined)
    assert.equal(spots.length, 7)
    assert.equal(payload.full_name, 'Ada Lovelace')
    assert.equal(payload.bio, null)
    assert.deepEqual(payload.favorite_spots, ['a', 'b', 'c', 'd', 'e', 'f'])
    assertIso(payload.updated_at)
  })

  await t.test('saveProfile reports a missing supabase client', async () => {
    const caught = await rejectionOf(api.saveProfile('user-1', {
      full_name: 'Ada',
      bio: 'Campus',
      favorite_spots: [],
    }))
    assert.equal(caught.message, 'Supabase is not configured')
    assertHuman(caught.message)
  })

  await t.test('saveProfile surfaces a readable supabase error', async () => {
    useClient(() => ({ error: { message: 'permission denied for table profiles' } }))
    const caught = await rejectionOf(api.saveProfile('user-1', {
      full_name: 'Ada',
      bio: '',
      favorite_spots: [],
    }))
    assert.equal(caught.message, 'permission denied for table profiles')
    assertHuman(caught.message)
  })

  await t.test('saveProfile copies a non-readable supabase error message', async () => {
    // BUG?: error.message is passed to Error() unchanged. A missing message becomes "",
    // null becomes "null", an object becomes "[object Object]", and a stack is shown whole.
    const cases = [
      [{}, ''],
      [{ message: null }, 'null'],
      [{ message: { code: '42501' } }, '[object Object]'],
      [{ message: RAW_STACK }, RAW_STACK],
    ]
    for (const [supabaseError, expected] of cases) {
      useClient(() => ({ error: supabaseError }))
      const caught = await rejectionOf(api.saveProfile('user-1', {
        full_name: 'Ada',
        bio: '',
        favorite_spots: [],
      }))
      assert.equal(caught.message, expected)
    }
  })

  await t.test('saveProfile propagates a network failure and a timeout', async () => {
    for (const error of [networkError(), timeoutError()]) {
      useClient(() => {
        throw error
      })
      const caught = await rejectionOf(api.saveProfile('user-1', {
        full_name: 'Ada',
        bio: '',
        favorite_spots: [],
      }))
      assert.equal(caught, error)
      assertHuman(caught.message)
    }
  })

  await t.test('saveNotificationPrefs writes the phone and the profile', async () => {
    const prefs = { ride: false, billing: true, friends: true, promotions: true, system: true }
    let payload = null
    useClient((op) => {
      payload = op.payload
      assert.equal(op.table, 'profiles')
      assert.equal(op.action, 'update')
      assert.deepEqual(op.filters, [['eq', 'id', 'user-1']])
      return { error: null }
    })
    const result = await api.saveNotificationPrefs('user-1', prefs)
    assert.deepEqual(result, { persisted: true, note: 'Saved to your profile.' })
    assertHuman(result.note)
    assert.deepEqual(JSON.parse(state().items.get(prefsKey('user-1'))), prefs)
    assert.equal(payload.notification_prefs, prefs)
    assertIso(payload.updated_at)
  })

  await t.test('saveNotificationPrefs keeps the phone copy when supabase is null', async () => {
    const prefs = { ride: true, billing: false, friends: true, promotions: false, system: true }
    const result = await api.saveNotificationPrefs('user-1', prefs)
    assert.deepEqual(result, { persisted: false, note: 'Saved on this phone.' })
    assertHuman(result.note)
    assert.deepEqual(JSON.parse(state().items.get(prefsKey('user-1'))), prefs)
    assert.equal(state().ops.length, 0)
  })

  await t.test('saveNotificationPrefs keeps the phone copy when the profile write fails', async () => {
    const prefs = { ride: false, billing: true, friends: false, promotions: true, system: true }
    useClient(() => ({ error: { message: 'permission denied for table profiles' } }))
    const result = await api.saveNotificationPrefs('user-1', prefs)
    assert.deepEqual(result, {
      persisted: false,
      note: 'Saved on this phone. permission denied for table profiles',
    })
    assertHuman(result.note)
    assert.deepEqual(JSON.parse(state().items.get(prefsKey('user-1'))), prefs)
  })

  await t.test('saveNotificationPrefs interpolates a non-readable supabase error', async () => {
    // BUG?: the note is `Saved on this phone. ${error.message}`. A missing message
    // becomes the word "undefined", null becomes "null", an object becomes
    // "[object Object]", and a stack is appended whole.
    const prefs = { ride: true, billing: true, friends: true, promotions: false, system: true }
    const cases = [
      [{}, 'Saved on this phone. undefined'],
      [{ message: null }, 'Saved on this phone. null'],
      [{ message: { code: '42501' } }, 'Saved on this phone. [object Object]'],
      [{ message: RAW_STACK }, `Saved on this phone. ${RAW_STACK}`],
    ]
    for (const [supabaseError, note] of cases) {
      useClient(() => ({ error: supabaseError }))
      const result = await api.saveNotificationPrefs('user-1', prefs)
      assert.equal(result.persisted, false)
      assert.equal(result.note, note)
      assert.deepEqual(JSON.parse(state().items.get(prefsKey('user-1'))), prefs)
    }
  })

  await t.test('saveNotificationPrefs rejects when the phone write throws', async () => {
    // BUG?: a throwing on-device write rejects with the raw storage error. There is
    // no { persisted: false, note } result, and a non-readable message is not replaced.
    const prefs = { ride: true, billing: true, friends: true, promotions: false, system: true }
    state().setError = networkError()
    const offline = await rejectionOf(api.saveNotificationPrefs('user-1', prefs))
    assert.equal(offline instanceof TypeError, true)
    assert.equal(offline.message, 'Network request failed')
    assert.equal(state().items.has(prefsKey('user-1')), false)

    state().setError = new Error('[object Object]')
    const ugly = await rejectionOf(api.saveNotificationPrefs('user-1', prefs))
    assert.equal(ugly.message, '[object Object]')
  })

  await t.test('saveNotificationPrefs rejects when the profile write throws after the phone save', async () => {
    // BUG?: the { error } branch returns { persisted: false, note: "Saved on this phone. …" }.
    // A thrown network or timeout error rejects even though the phone copy was already written.
    const prefs = { ride: false, billing: true, friends: true, promotions: true, system: false }
    for (const error of [networkError(), timeoutError()]) {
      state().items.clear()
      useClient(() => {
        throw error
      })
      const caught = await rejectionOf(api.saveNotificationPrefs('user-1', prefs))
      assert.equal(caught, error)
      assertHuman(caught.message)
      assert.deepEqual(JSON.parse(state().items.get(prefsKey('user-1'))), prefs)
    }
  })

  await t.test('listHistory returns the latest trips for the rider', async () => {
    const rows = [
      {
        id: 'trip-1',
        status: 'completed',
        pickup_label: 'White C',
        dropoff_label: 'GSP',
        created_at: '2026-09-25T00:00:00Z',
      },
    ]
    useClient((op) => {
      assert.equal(op.table, 'trips')
      assert.deepEqual(op.filters, [['eq', 'rider_id', 'user-1']])
      assert.deepEqual(op.order, { column: 'created_at', options: { ascending: false } })
      assert.equal(op.limit, 12)
      return { data: rows, error: null }
    })
    assert.deepEqual(await api.listHistory('user-1'), rows)
  })

  await t.test('listHistory is an empty list when supabase or the rows are missing', async () => {
    assert.deepEqual(await api.listHistory('user-1'), [])
    for (const data of [null, undefined]) {
      useClient(() => ({ data, error: null }))
      assert.deepEqual(await api.listHistory('user-1'), [])
    }
  })

  await t.test('listHistory surfaces a readable supabase error', async () => {
    useClient(() => ({ data: [{ id: 'hidden' }], error: { message: 'permission denied for table trips' } }))
    const caught = await rejectionOf(api.listHistory('user-1'))
    assert.equal(caught.message, 'permission denied for table trips')
    assertHuman(caught.message)
  })

  await t.test('listHistory copies a non-readable supabase error message', async () => {
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
      const caught = await rejectionOf(api.listHistory('user-1'))
      assert.equal(caught.message, expected)
    }
  })

  await t.test('listHistory propagates a network failure and a timeout', async () => {
    for (const error of [networkError(), timeoutError()]) {
      useClient(() => {
        throw error
      })
      const caught = await rejectionOf(api.listHistory('user-1'))
      assert.equal(caught, error)
      assertHuman(caught.message)
    }
  })
})
