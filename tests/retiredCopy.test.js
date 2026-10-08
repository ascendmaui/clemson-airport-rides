import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const NEEDLE = new RegExp(
  [
    'te' + 'sla',
    'model' + ' 3',
    'self' + '-driving',
    'robo' + 'taxi',
    'cy' + 'ber',
    'at the ' + 'wheel',
    'driver-' + 'operated',
    'driver ' + 'operated',
    'autonomy ' + 'session',
    'a driver still ' + 'drives',
    'clemson ' + 'fleet',
  ].join('|'),
  'i',
)
const CONTENT_ALLOW = new Set([
  'shared/demoFleet.js',
  'docs/demo-drivers.md',
  'public/demo-drivers/manifest.json',
])
const NAME_ALLOW = new Set([
  'supabase/migrations/20261004220000_' + 'te' + 'sla_' + 'model' + '_3_fleet.sql',
])

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'dist') continue
    const abs = path.join(dir, name)
    const rel = path.relative(root, abs)
    if (statSync(abs).isDirectory()) walk(abs, out)
    else out.push(rel)
  }
  return out
}

test('retired fleet words stay in the demo-map allow-list', () => {
  const hits = []
  for (const rel of walk(root)) {
    const base = rel.split(path.sep).join('/')
    if (NEEDLE.test(base) && !NAME_ALLOW.has(base) && !CONTENT_ALLOW.has(base)) hits.push(base)
    if (CONTENT_ALLOW.has(base) || NAME_ALLOW.has(base)) continue
    if (!/\.(js|jsx|mjs|ts|tsx|md|sql|json|html|css|svg)$/.test(base)) continue
    const text = readFileSync(path.join(root, rel), 'utf8')
    if (NEEDLE.test(text)) hits.push(base)
  }
  assert.deepEqual(hits, [])
})
