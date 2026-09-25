import assert from 'node:assert/strict'
import test from 'node:test'
import { ensureProfile } from './ensureProfile.js'

function createFakeSb({
  existing = null,
  selectError = null,
  upsertErrors = [],
  upsertHandler = null,
} = {}) {
  const calls = []
  let upsertCount = 0

  const sb = {
    calls,
    from(table) {
      calls.push({ op: 'from', table })
      return {
        select(columns) {
          calls.push({ op: 'select', table, columns })
          return {
            eq(col, val) {
              calls.push({ op: 'eq', table, col, val })
              return {
                async maybeSingle() {
                  calls.push({ op: 'maybeSingle', table, col, val })
                  if (selectError) {
                    return { data: null, error: selectError }
                  }
                  return { data: existing, error: null }
                },
              }
            },
          }
        },
        async upsert(payload, options) {
          const callIndex = upsertCount++
          calls.push({ op: 'upsert', table, payload: { ...payload }, options: { ...options }, callIndex })
          if (typeof upsertHandler === 'function') {
            return upsertHandler(payload, options, callIndex)
          }
          if (upsertErrors.length > callIndex) {
            const err = upsertErrors[callIndex]
            if (err) return { data: null, error: err }
          }
          return { data: null, error: null }
        },
      }
    },
  }

  return { sb, calls }
}

test('existing row: returns ok:true, created:false with no write', async () => {
  const userId = '11111111-1111-4111-8111-111111111111'
  const { sb, calls } = createFakeSb({ existing: { id: userId } })

  const user = {
    id: userId,
    email: 'existing@clemson.edu',
    user_metadata: { full_name: 'Existing Rider' },
  }

  const res = await ensureProfile(sb, user)

  assert.deepEqual(res, { ok: true, created: false })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 0, 'Must perform no upsert if profile already exists')

  const select = calls.find((c) => c.op === 'select')
  assert.ok(select, 'Must perform select')
  assert.equal(select.columns, 'id')

  const eq = calls.find((c) => c.op === 'eq')
  assert.deepEqual({ col: eq.col, val: eq.val }, { col: 'id', val: userId })
})

test('missing row: performs one upsert with correct payload and options', async () => {
  const userId = '22222222-2222-4222-8222-222222222222'
  const { sb, calls } = createFakeSb({ existing: null })

  const user = {
    id: userId,
    email: 'newrider@clemson.edu',
    user_metadata: { full_name: 'New Rider' },
  }

  const res = await ensureProfile(sb, user)

  assert.deepEqual(res, { ok: true, created: true })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 1, 'Must perform exactly one upsert')

  const call = upserts[0]
  assert.equal(call.table, 'profiles')
  assert.deepEqual(call.options, { onConflict: 'id', ignoreDuplicates: true })
  assert.deepEqual(call.payload, {
    id: userId,
    email: 'newrider@clemson.edu',
    full_name: 'New Rider',
    role: 'rider',
  })
})

test('missing row: falls back to user_metadata.name and handles null email', async () => {
  const userId = '33333333-3333-4333-8333-333333333333'
  const { sb, calls } = createFakeSb({ existing: null })

  const user = {
    id: userId,
    user_metadata: { name: 'Fallback Name' },
  }

  const res = await ensureProfile(sb, user)

  assert.deepEqual(res, { ok: true, created: true })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 1)
  assert.deepEqual(upserts[0].payload, {
    id: userId,
    email: null,
    full_name: 'Fallback Name',
    role: 'rider',
  })
})

test('23505 race: returns ok:true, created:false on Postgres unique violation', async () => {
  const userId = '44444444-4444-4444-8444-444444444444'
  const uniqueErr = {
    code: '23505',
    message: 'duplicate key value violates unique constraint "profiles_pkey"',
    details: `Key (id)=(${userId}) already exists.`,
  }
  const { sb, calls } = createFakeSb({
    existing: null,
    upsertErrors: [uniqueErr],
  })

  const user = {
    id: userId,
    email: 'concurrent@clemson.edu',
    user_metadata: { full_name: 'Concurrent Rider' },
  }

  const res = await ensureProfile(sb, user)

  assert.deepEqual(res, { ok: true, created: false })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 1, 'Should not retry when 23505 is returned')
})

test('23505 race: matches 23505 in error message when error code is missing', async () => {
  const userId = '44444444-4444-4444-8444-444444444445'
  const { sb } = createFakeSb({
    existing: null,
    upsertErrors: [{ message: 'duplicate key value violates unique constraint 23505' }],
  })

  const res = await ensureProfile(sb, { id: userId, email: 'race@clemson.edu' })
  assert.deepEqual(res, { ok: true, created: false })
})

test('column-error fallback: retries once with just { id, email } when schema/column error occurs', async () => {
  const userId = '55555555-5555-4555-8555-555555555555'
  const columnErr = {
    code: 'PGRST204',
    message: "Could not find the 'full_name' column of 'profiles' in the schema cache",
  }
  const { sb, calls } = createFakeSb({
    existing: null,
    upsertErrors: [columnErr, null],
  })

  const user = {
    id: userId,
    email: 'narrow@clemson.edu',
    user_metadata: { full_name: 'Narrow Rider' },
  }

  const res = await ensureProfile(sb, user)

  assert.deepEqual(res, { ok: true, created: true })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 2, 'Must retry once after column error')

  // First call had full payload
  assert.deepEqual(upserts[0].payload, {
    id: userId,
    email: 'narrow@clemson.edu',
    full_name: 'Narrow Rider',
    role: 'rider',
  })

  // Second call had only id and email
  assert.deepEqual(upserts[1].payload, {
    id: userId,
    email: 'narrow@clemson.edu',
  })
  assert.deepEqual(upserts[1].options, {
    onConflict: 'id',
    ignoreDuplicates: true,
  })
})

test('column-error fallback: treats 23505 on retry as success (created:false)', async () => {
  const userId = '55555555-5555-4555-8555-555555555556'
  const { sb } = createFakeSb({
    existing: null,
    upsertErrors: [
      { code: '42703', message: 'column "role" of relation "profiles" does not exist' },
      { code: '23505', message: 'duplicate key value violates unique constraint' },
    ],
  })

  const res = await ensureProfile(sb, { id: userId, email: 'retry-race@clemson.edu' })
  assert.deepEqual(res, { ok: true, created: false })
})

test('generic error: returns ok:false, reason:profile_upsert_failed and message on upsert failure', async () => {
  const userId = '66666666-6666-4666-8666-666666666666'
  const dbErr = {
    code: '08006',
    message: 'connection failure during upsert',
  }
  const { sb, calls } = createFakeSb({
    existing: null,
    upsertErrors: [dbErr],
  })

  const user = {
    id: userId,
    email: 'fail@clemson.edu',
  }

  const res = await ensureProfile(sb, user)

  assert.deepEqual(res, {
    ok: false,
    reason: 'profile_upsert_failed',
    message: 'connection failure during upsert',
  })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 1, 'Should not retry on generic errors')
})

test('generic error: returns ok:false, reason:profile_upsert_failed when retry fails', async () => {
  const userId = '66666666-6666-4666-8666-666666666667'
  const { sb, calls } = createFakeSb({
    existing: null,
    upsertErrors: [
      { message: 'schema cache reload required' },
      { message: 'disk full on retry' },
    ],
  })

  const res = await ensureProfile(sb, { id: userId, email: 'fail-retry@clemson.edu' })

  assert.deepEqual(res, {
    ok: false,
    reason: 'profile_upsert_failed',
    message: 'disk full on retry',
  })

  const upserts = calls.filter((c) => c.op === 'upsert')
  assert.equal(upserts.length, 2)
})

test('missing user: returns ok:false, reason:no_user without throwing', async () => {
  const { sb, calls } = createFakeSb({ existing: null })

  // Null / undefined sb
  assert.deepEqual(await ensureProfile(null, { id: 'u1' }), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(undefined, { id: 'u1' }), { ok: false, reason: 'no_user' })

  // Missing / invalid user
  assert.deepEqual(await ensureProfile(sb, null), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(sb, undefined), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(sb, {}), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(sb, { id: null }), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(sb, { id: undefined }), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(sb, { id: '' }), { ok: false, reason: 'no_user' })
  assert.deepEqual(await ensureProfile(sb, 'not-an-object'), { ok: false, reason: 'no_user' })

  assert.equal(calls.length, 0, 'No queries should be made when user/sb is invalid')
})
