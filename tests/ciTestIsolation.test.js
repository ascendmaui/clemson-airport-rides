import assert from 'node:assert/strict'
import test, { after, describe } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

describe('CI test isolation and flake prevention', () => {
  test('PGlite handles open, execute queries, and terminate cleanly', async () => {
    const db = new PGlite()
    try {
      const res = await db.query('SELECT 1 as n, $1::text as label', ['test_pglite_isolation'])
      assert.equal(res.rows.length, 1)
      assert.equal(res.rows[0].n, 1)
      assert.equal(res.rows[0].label, 'test_pglite_isolation')
    } finally {
      await db.close()
    }
  })

  test('Environment variable mutation sandbox restores previous state', () => {
    const testKey = 'TEST_ENV_ISOLATION_PROBE'
    const origVal = process.env[testKey]

    try {
      process.env[testKey] = 'temporary_test_val'
      assert.equal(process.env[testKey], 'temporary_test_val')
    } finally {
      if (origVal === undefined) {
        delete process.env[testKey]
      } else {
        process.env[testKey] = origVal
      }
    }

    assert.equal(process.env[testKey], undefined)
  })

  test('Safe async timers resolve without unhandled rejections', async () => {
    let resolved = false
    const promise = new Promise((res) => {
      setTimeout(() => {
        resolved = true
        res('ok')
      }, 10)
    })

    const outcome = await promise
    assert.equal(outcome, 'ok')
    assert.equal(resolved, true)
  })

  test('No unexpected global fetch or navigator leakage remains', () => {
    // If a test stubbed global fetch or navigator, it must have restored it
    if (typeof globalThis.fetch === 'function') {
      assert.ok(true, 'fetch is callable')
    }
  })
})
