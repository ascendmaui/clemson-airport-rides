import assert from 'node:assert/strict'
import test from 'node:test'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('./compare-competitors.mjs', import.meta.url))

function run(args) {
  const env = { ...process.env }
  delete env.SUPABASE_SERVICE_ROLE_KEY
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env })
}

test('offline report covers every tier and trip and flags the conflicts', () => {
  const out = run(['--offline', '--json'])
  assert.equal(out.status, 0, out.stderr)
  const report = JSON.parse(out.stdout)
  assert.equal(report.source, 'seed')
  assert.equal(report.rows.length, 4 * 5)
  assert.ok(report.alerts.some((a) => a.kind === 'margin_blocks_undercut'))
  assert.equal(report.plan.ok, false)
})

test('--apply without DB credentials writes nothing and fails', () => {
  const out = run(['--apply'])
  assert.equal(out.status, 1)
  assert.match(out.stderr, /nothing written/)
})
