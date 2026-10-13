import test from 'node:test'
import assert from 'node:assert/strict'
import { readDriverPushToken, readDriverPushTokens } from './driverPushToken.js'

function client(tables = {}, errors = {}) {
  const calls = []
  return { calls, from(table) {
    calls.push(table)
    if (errors[table] === 'throw') throw new Error('unavailable')
    let ids = null
    const result = () => ({ data: (tables[table] || []).filter(row => !ids || ids.includes(row.driver_id)), error: errors[table] || null })
    const q = {
      select() { return q }, eq(_, id) { ids = [id]; return q }, in(_, values) { ids = values; return q }, limit() { return q },
      async maybeSingle() { const r = result(); return { ...r, data: r.data[0] || null } },
      then(resolve, reject) { return Promise.resolve(result()).then(resolve, reject) },
    }
    return q
  } }
}

test('private token wins and avoids reading public presence', async () => {
  const sb = client({ driver_push_tokens: [{ driver_id: 'd', token: ' ExpoPushToken[new] ', platform: ' ios ' }], driver_status: [{ driver_id: 'd', expo_push_token: 'old' }] })
  assert.deepEqual(await readDriverPushToken(sb, 'd'), { token: 'ExpoPushToken[new]', platform: 'ios', source: 'driver_push_tokens' })
  assert.deepEqual(sb.calls, ['driver_push_tokens'])
})

test('missing or failed private table falls back to optional legacy token', async () => {
  for (const error of [null, { message: 'schema cache' }, 'throw']) {
    const sb = client({ driver_status: [{ driver_id: 'd', expo_push_token: ' ExponentPushToken[old] ' }] }, { driver_push_tokens: error })
    assert.deepEqual(await readDriverPushToken(sb, 'd'), { token: 'ExponentPushToken[old]', platform: null, source: 'driver_status' })
  }
})

test('missing columns, query errors, and unavailable clients never throw', async () => {
  for (const sb of [null, {}, client({}, { driver_push_tokens: 'throw', driver_status: 'throw' }), client({}, { driver_status: { message: 'expo_push_token missing' } })]) {
    assert.deepEqual(await readDriverPushToken(sb, 'd'), { token: null, platform: null, source: null })
    assert.equal((await readDriverPushTokens(sb, ['d'])).get('d').token, null)
  }
  assert.deepEqual(await readDriverPushToken(null, null), { token: null, platform: null, source: null })
})

test('batch preserves private precedence and fills missing drivers from legacy', async () => {
  const sb = client({ driver_push_tokens: [{ driver_id: 'a', token: 'new' }], driver_status: [{ driver_id: 'a', expo_push_token: 'old' }, { driver_id: 'b', expo_push_token: 'legacy' }] })
  const result = await readDriverPushTokens(sb, ['a', 'b', 'c', 'a'])
  assert.equal(result.size, 3)
  assert.equal(result.get('a').token, 'new')
  assert.equal(result.get('b').source, 'driver_status')
  assert.equal(result.get('c').token, null)
  assert.equal((await readDriverPushTokens(sb, [])).size, 0)
  assert.equal((await readDriverPushTokens(sb)).size, 2)
})
