import assert from 'node:assert/strict'
import test from 'node:test'
import {
  filterVisibleTrips,
  loadComfortPreference,
  pairAllowedByRpc,
  saveComfortPreference,
  visibleTripIdSet,
} from './comfortPreference.js'

function supabaseWith(profile, { updateError = null, rpc = null } = {}) {
  const updates = []
  return {
    updates,
    from() {
      const api = {
        select() { return api },
        eq() { return api },
        update(payload) {
          updates.push(payload)
          api._updateError = updateError
          return api
        },
        async maybeSingle() {
          return { data: profile, error: profile?.error || null }
        },
        then(resolve) {
          resolve({ data: null, error: api._updateError })
        },
      }
      return api
    },
    rpc,
  }
}

test('load treats a missing column as unavailable and does not throw', async () => {
  const missing = supabaseWith({ error: { message: 'column profiles.gender_identity does not exist' } })
  const loaded = await loadComfortPreference(missing, 'rider-1')
  assert.equal(loaded.available, false)
  assert.equal(loaded.womenOnlyMatching, false)
})

test('save writes the sanitized preference and refuses it for anyone who is not a woman', async () => {
  const sb = supabaseWith({ gender_identity: 'woman', women_only_matching: false })
  const saved = await saveComfortPreference(sb, 'rider-1', { genderIdentity: 'woman', womenOnly: true })
  assert.equal(saved.womenOnlyMatching, true)
  assert.equal(sb.updates[0].gender_identity, 'woman')
  await assert.rejects(
    saveComfortPreference(sb, 'rider-1', { genderIdentity: 'nonbinary', womenOnly: true }),
    /identify as a woman/,
  )
})

test('desk visibility ignores a missing rpc and filters when the database returns ids', async () => {
  const rows = [{ id: 'a' }, { id: 'b' }]
  assert.equal(await visibleTripIdSet({ rpc: undefined }, ['a']), null)
  assert.deepEqual(filterVisibleTrips(rows, null), rows)
  const hidden = {
    async rpc() {
      return { data: null, error: { message: 'function women_only_visible_trips does not exist' } }
    },
  }
  assert.equal(await visibleTripIdSet(hidden, ['a']), null)
  const filtered = {
    async rpc(_name, args) {
      assert.deepEqual(args.trip_ids, ['a', 'b'])
      return { data: ['b'], error: null }
    },
  }
  const ids = await visibleTripIdSet(filtered, ['a', 'b'])
  assert.deepEqual(filterVisibleTrips(rows, ids).map((row) => row.id), ['b'])
  const allowed = await pairAllowedByRpc({
    async rpc() { return { data: false, error: null } },
  }, 'rider-1', 'driver-1')
  assert.equal(allowed, false)
})
