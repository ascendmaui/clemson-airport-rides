import assert from 'node:assert/strict'
import test from 'node:test'
import { parseSupabaseAuthUrl } from './authUrl.js'

test('password recovery deep links keep the Supabase session tokens', () => {
  const parsed = parseSupabaseAuthUrl(
    'clemsonrides://reset-password#access_token=aaa&refresh_token=bbb&type=recovery',
  )
  assert.deepEqual(parsed, {
    kind: 'session',
    accessToken: 'aaa',
    refreshToken: 'bbb',
    type: 'recovery',
  })
})

test('PKCE recovery links keep the code', () => {
  const parsed = parseSupabaseAuthUrl('clemsonrides://reset-password?code=pkce-code&type=recovery')
  assert.equal(parsed.kind, 'code')
  assert.equal(parsed.code, 'pkce-code')
  assert.equal(parsed.type, 'recovery')
})
