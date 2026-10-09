import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { resolve as resolveLib } from './fixtures/resolve-lib-imports.js'

const __filename = fileURLToPath(import.meta.url)
const REPO_ROOT = path.resolve(path.dirname(__filename), '..')

function cleanTestEnv(extra = {}) {
  const env = { ...process.env, ...extra }
  for (const k of Object.keys(env)) {
    if (k.startsWith('NODE_TEST')) delete env[k]
  }
  return env
}

test('server/tripWait.test.js executes cleanly regardless of invocation working directory', () => {
  // Test running from the server/ subdirectory to ensure relative module resolution
  // does not fail with ERR_MODULE_NOT_FOUND
  const serverDir = path.join(REPO_ROOT, 'server')
  const result = execFileSync(
    process.execPath,
    ['--experimental-strip-types', '--test', 'tripWait.test.js'],
    {
      cwd: serverDir,
      encoding: 'utf8',
      env: cleanTestEnv({ STRIPE_SECRET_KEY: '' }),
    },
  )
  assert.match(result, /pass 44/, 'all 44 tests in tripWait.test.js pass when run from server/')
  assert.doesNotMatch(result, /ERR_MODULE_NOT_FOUND/, 'does not fail with ERR_MODULE_NOT_FOUND')
})

test('server/depositRefund.test.js preserves and restores environment keys', () => {
  const origMaps = process.env.GOOGLE_MAPS_API_KEY
  const origRoutes = process.env.GOOGLE_ROUTES_API_KEY
  try {
    process.env.GOOGLE_MAPS_API_KEY = 'test_key_maps_isolation'
    process.env.GOOGLE_ROUTES_API_KEY = 'test_key_routes_isolation'

    // Run depositRefund.test.js
    const out = execFileSync(
      process.execPath,
      ['--experimental-strip-types', '--test', 'server/depositRefund.test.js'],
      {
        cwd: REPO_ROOT,
        encoding: 'utf8',
        env: cleanTestEnv({
          GOOGLE_MAPS_API_KEY: 'test_key_maps_isolation',
          GOOGLE_ROUTES_API_KEY: 'test_key_routes_isolation',
        }),
      },
    )
    assert.match(out, /pass 12/, 'all 12 tests in depositRefund pass')
  } finally {
    if (origMaps !== undefined) process.env.GOOGLE_MAPS_API_KEY = origMaps
    else delete process.env.GOOGLE_MAPS_API_KEY
    if (origRoutes !== undefined) process.env.GOOGLE_ROUTES_API_KEY = origRoutes
    else delete process.env.GOOGLE_ROUTES_API_KEY
  }
})

test('resolve-lib-imports hook redirects ./supabase for any src/lib module', async () => {
  const dummyContext = {
    parentURL: 'file:///path/to/project/src/lib/customModule.js',
  }

  const stubResult = await resolveLib('./supabase', dummyContext, async () => {
    throw new Error('should not fall through for ./supabase')
  })

  assert.equal(stubResult.format, 'module')
  assert.equal(stubResult.shortCircuit, true)
  assert.match(stubResult.url, /supabase-stub\.js$/)

  const stubResultWithExt = await resolveLib('./supabase.js', dummyContext, async () => {
    throw new Error('should not fall through for ./supabase.js')
  })

  assert.equal(stubResultWithExt.format, 'module')
  assert.equal(stubResultWithExt.shortCircuit, true)
  assert.match(stubResultWithExt.url, /supabase-stub\.js$/)
})
