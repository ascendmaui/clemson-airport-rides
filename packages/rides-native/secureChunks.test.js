import assert from 'node:assert/strict'
import test from 'node:test'
import { SECURE_CHUNK, createChunkedStore } from './secureChunks.js'

function memoryBackend() {
  const data = new Map()
  return {
    data,
    async getItem(key) {
      return data.has(key) ? data.get(key) : null
    },
    async setItem(key, value) {
      if (value.length > 2048) throw new Error(`value for ${key} exceeds SecureStore limit`)
      data.set(key, value)
    },
    async removeItem(key) {
      data.delete(key)
    },
  }
}

test('small values stay in one SecureStore item', async () => {
  const backend = memoryBackend()
  const store = createChunkedStore(backend)
  await store.setItem('sb-session', 'short-token')
  assert.equal(await store.getItem('sb-session'), 'short-token')
  assert.equal(backend.data.has('sb-session.n'), false)
})

test('a Supabase-sized session is split under the SecureStore cap and round-trips', async () => {
  const backend = memoryBackend()
  const store = createChunkedStore(backend)
  const session = JSON.stringify({
    access_token: 'a'.repeat(2400),
    refresh_token: 'b'.repeat(2400),
    user: { id: 'user-1', email: 'tiger@clemson.edu' },
  })
  assert.ok(session.length > 2048)
  await store.setItem('sb-awktabuhijrshmsmagpq-auth-token', session)
  assert.equal(await store.getItem('sb-awktabuhijrshmsmagpq-auth-token'), session)
  for (const [key, value] of backend.data) {
    assert.ok(value.length <= SECURE_CHUNK, key)
  }
  assert.equal(backend.data.has('sb-awktabuhijrshmsmagpq-auth-token'), false)
  await store.removeItem('sb-awktabuhijrshmsmagpq-auth-token')
  assert.equal(await store.getItem('sb-awktabuhijrshmsmagpq-auth-token'), null)
  assert.equal(backend.data.size, 0)
})
