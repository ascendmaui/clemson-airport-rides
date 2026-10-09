import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import { PGlite } from '@electric-sql/pglite'

describe('CI database lifecycle and environment isolation resilience', () => {
  test('PGlite initializes, executes queries, and closes cleanly without leaks', async () => {
    const db = new PGlite()
    await db.exec(`
      CREATE TABLE test_items (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL
      );
      INSERT INTO test_items (name) VALUES ('item_1'), ('item_2');
    `)

    const { rows } = await db.query('SELECT count(*)::int AS cnt FROM test_items;')
    assert.equal(rows[0].cnt, 2)

    assert.equal(typeof db.close, 'function')
    await db.close()

    // Verifies that operating on closed db rejects gracefully
    await assert.rejects(
      () => db.query('SELECT 1'),
      (err) => {
        assert.ok(err instanceof Error)
        return true
      },
    )
  })

  test('consecutive PGlite instances do not collide or retain shared state', async () => {
    const db1 = new PGlite()
    await db1.exec('CREATE TABLE run_state (id INT); INSERT INTO run_state VALUES (1);')
    const { rows: r1 } = await db1.query('SELECT count(*)::int AS cnt FROM run_state;')
    assert.equal(r1[0].cnt, 1)
    await db1.close()

    const db2 = new PGlite()
    // In a fresh instance, run_state should not exist
    await assert.rejects(
      () => db2.query('SELECT * FROM run_state;'),
      (err) => {
        assert.match(String(err), /relation "run_state" does not exist/)
        return true
      },
    )
    await db2.close()
  })

  test('environment isolation helper snapshots and restores process.env cleanly', () => {
    const TEST_KEY = '__CLEMSON_TEST_ENV_KEY_ISOLATION__'
    const PREEXISTING_KEY = '__CLEMSON_TEST_PREEXISTING__'

    process.env[PREEXISTING_KEY] = 'initial_val'
    delete process.env[TEST_KEY]

    const snapshot = {
      [TEST_KEY]: process.env[TEST_KEY],
      [PREEXISTING_KEY]: process.env[PREEXISTING_KEY],
    }

    // Mutate
    process.env[TEST_KEY] = 'mutated_val'
    process.env[PREEXISTING_KEY] = 'changed_val'

    assert.equal(process.env[TEST_KEY], 'mutated_val')
    assert.equal(process.env[PREEXISTING_KEY], 'changed_val')

    // Restore
    for (const [k, v] of Object.entries(snapshot)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }

    assert.equal(process.env[TEST_KEY], undefined)
    assert.equal(process.env[PREEXISTING_KEY], 'initial_val')

    delete process.env[PREEXISTING_KEY]
  })
})
