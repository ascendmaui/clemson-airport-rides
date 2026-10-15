import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const home = readFileSync(new URL('../apps/rider/app/(tabs)/index.tsx', import.meta.url), 'utf8')

test('home map keeps Game day and Surge and drops the Busy Areas control', () => {
  assert.doesNotMatch(home, /Busy Areas/)
  assert.doesNotMatch(home, /HEAT_WINDOWS/)
  assert.doesNotMatch(home, /setHeatWindow/)
  assert.doesNotMatch(home, /Busy areas are hidden/)
  assert.match(home, /Game day…/)
  assert.match(home, /Surge · On/)
  assert.match(home, /label=\{surge \? 'Surge · On' : 'Surge'\}/)
})
