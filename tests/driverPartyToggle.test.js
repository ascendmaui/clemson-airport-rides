import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { toggleWithRevert } from '../apps/driver/lib/partyToggle.ts'

test('failed save reverts the chip and reports the error', async () => {
  const seen = []
  let failed = null
  const result = await toggleWithRevert({
    current: 'off', next: 'on', apply: (v) => seen.push(v),
    save: async () => { throw new Error('offline') },
    reload: async () => 'reloaded',
    onFail: (err) => { failed = err.message },
  })
  assert.equal(result, 'failed')
  assert.deepEqual(seen, ['on', 'off'])
  assert.equal(failed, 'offline')
})

test('successful save keeps the new value even if the reload fails', async () => {
  const seen = []
  let reloadErr = null
  const result = await toggleWithRevert({
    current: 'off', next: 'on', apply: (v) => seen.push(v),
    save: async () => {}, reload: async () => { throw new Error('reload') },
    onFail: () => assert.fail('save did not fail'),
    onReloadFail: (err) => { reloadErr = err.message },
  })
  assert.equal(result, 'saved')
  assert.deepEqual(seen, ['on'])
  assert.equal(reloadErr, 'reload')
})

test('successful save then applies the server view', async () => {
  const seen = []
  await toggleWithRevert({ current: 'off', next: 'on', apply: (v) => seen.push(v), save: async () => {}, reload: async () => 'server', onFail: () => {} })
  assert.deepEqual(seen, ['on', 'server'])
})

test('a second tap while saving is ignored', async () => {
  const busy = { current: false }
  let release
  const saves = []
  const first = toggleWithRevert({ current: 0, next: 1, apply: () => {}, save: () => { saves.push(1); return new Promise((r) => { release = r }) }, onFail: () => {}, busy })
  assert.equal(await toggleWithRevert({ current: 1, next: 0, apply: () => {}, save: async () => saves.push(2), onFail: () => {}, busy }), 'busy')
  release()
  assert.equal(await first, 'saved')
  assert.deepEqual(saves, [1])
  assert.equal(busy.current, false)
})

test('PerksStrip uses the revert helper with a visible toast, not a silent rollback', () => {
  const src = fs.readFileSync(new URL('../apps/driver/components/PerksStrip.tsx', import.meta.url), 'utf8')
  assert.match(src, /toggleWithRevert<DriverPerks>/)
  assert.match(src, /failureToast\(\{\s*key: 'party-queue'/)
  assert.match(src, /retry: toggleParty/)
  assert.doesNotMatch(src, /\.catch\(\(\) => setPerks\(perks\)\)/)
})
