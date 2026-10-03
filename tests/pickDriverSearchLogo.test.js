import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const pick = readFileSync(new URL('../src/screens/PickDriver.jsx', import.meta.url), 'utf8')
const native = readFileSync(new URL('../apps/rider/app/pick-driver.tsx', import.meta.url), 'utf8')
const loader = readFileSync(new URL('../apps/rider/components/ClemsonLoader.tsx', import.meta.url), 'utf8')
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8')

test('pick-a-driver keeps the empty result and shows the searching logo first', () => {
  assert.match(pick, /SearchingLogo/)
  assert.match(pick, /searchDelayMs/)
  assert.match(pick, /No drivers available/)
  assert.match(pick, /\{loading && <SkeletonDriverCard count=\{3\} \/>\}/)
  assert.match(css, /@keyframes clemson-logo-turn/)
  assert.match(css, /cubic-bezier/)
  assert.doesNotMatch(css, /clemson-logo-turn[\s\S]*linear/)
  assert.match(native, /ClemsonLoader/)
  assert.match(native, /phase === 'loading'/)
  assert.match(native, /Still searching/)
  assert.match(loader, /Easing\.inOut\(Easing\.cubic\)/)
  assert.doesNotMatch(loader, /Easing\.linear/)
})
