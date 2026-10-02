import assert from 'node:assert/strict'
import test from 'node:test'
import { execFileSync } from 'node:child_process'

/**
 * Executes a function with temporary process.env mutations, guaranteeing complete
 * teardown (including `delete process.env[key]` if it was originally undefined).
 */
export async function withCleanEnv(vars, fn) {
  const original = {}
  for (const [key, value] of Object.entries(vars)) {
    original[key] = process.env[key]
    if (value === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = String(value)
    }
  }

  try {
    return await fn()
  } finally {
    for (const [key, origVal] of Object.entries(original)) {
      if (origVal === undefined) {
        delete process.env[key]
      } else {
        process.env[key] = origVal
      }
    }
  }
}

test('CI flake hunters: withCleanEnv prevents "undefined" string pollution in process.env', async () => {
  const testVar = '__CI_TEMP_TEST_VAR_' + Date.now()
  assert.equal(process.env[testVar], undefined)

  await withCleanEnv({ [testVar]: 'temporary_value' }, async () => {
    assert.equal(process.env[testVar], 'temporary_value')
  })

  // Crucial check: must be undefined, not the literal string "undefined"
  assert.equal(process.env[testVar], undefined)
  assert.equal(testVar in process.env, false)
})

test('CI flake hunters: withCleanEnv preserves pre-existing env variables across exceptions', async () => {
  const existingVar = '__CI_EXISTING_VAR_' + Date.now()
  process.env[existingVar] = 'original_value'

  await assert.rejects(
    () =>
      withCleanEnv({ [existingVar]: 'mutated_value' }, async () => {
        assert.equal(process.env[existingVar], 'mutated_value')
        throw new Error('boom')
      }),
    /boom/,
  )

  assert.equal(process.env[existingVar], 'original_value')
  delete process.env[existingVar]
})

test('CI flake hunters: async rejection guard detects unhandled promise rejections cleanly', async () => {
  const unhandled = []
  const onUnhandled = (err) => {
    unhandled.push(err)
  }
  process.on('unhandledRejection', onUnhandled)

  try {
    // Normal caught async work emits no unhandled rejection
    await Promise.resolve('ok')
    await new Promise((resolve) => setImmediate(resolve))
    assert.equal(unhandled.length, 0)
  } finally {
    process.off('unhandledRejection', onUnhandled)
  }
})

test('CI flake hunters: child process test execution strips runner context to prevent recursive skip warning', () => {
  const cleanEnv = { ...process.env }
  for (const key of Object.keys(cleanEnv)) {
    if (key.startsWith('NODE_TEST')) {
      delete cleanEnv[key]
    }
  }

  const output = execFileSync(
    process.execPath,
    ['-e', 'console.log("runner_isolated_ok")'],
    {
      env: cleanEnv,
      encoding: 'utf8',
    },
  )

  assert.match(output, /runner_isolated_ok/)
  assert.doesNotMatch(output, /recursive/)
})
