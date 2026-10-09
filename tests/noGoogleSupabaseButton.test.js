import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { googleAuthButtonState, googleAuthConfig } from '../packages/rides-native/googleAuthConfig.js'

const CALL_SITES = [
  'apps/rider/app/sign-in.tsx',
  'apps/rider/app/sign-up.tsx',
  'apps/rider/lib/socialSignIn.ts',
  'apps/driver/app/sign-up.tsx',
]

test('supabase google sign-in stays enabled with an empty client-id env', () => {
  const config = googleAuthConfig({}, { scheme: 'clemsonrides', provider: 'supabase' })
  assert.equal(config.enabled, true)
  assert.equal(config.redirectUri, 'clemsonrides://auth/callback')
  const button = googleAuthButtonState({}, { scheme: 'clemsonrides', provider: 'supabase' })
  assert.equal(button.enabled, true)
  assert.equal(button.disabled, false)
  assert.equal(button.message, null)
  const comingSoon = googleAuthButtonState({}, { scheme: 'clemsonrides' })
  assert.equal(comingSoon.enabled, false)
  assert.equal(comingSoon.disabled, true)
})

test('rider and driver google buttons pass provider supabase', () => {
  for (const path of CALL_SITES) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.match(source, /provider:\s*'supabase'/, path)
  }
})
