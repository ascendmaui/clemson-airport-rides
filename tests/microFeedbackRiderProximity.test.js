import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8')

test('crowd loop interval is throttled to 2-3 s across the whole 500 ft zone', async () => {
  const src = read('apps/rider/lib/approachAlert.ts')
  assert.match(src, /CROWD_MIN_INTERVAL_MS = 2000/)
  assert.match(src, /CROWD_MAX_INTERVAL_MS = 3000/)
  assert.match(src, /const intervalMs = Math\.round\(CROWD_MIN_INTERVAL_MS \+ span \* \(CROWD_MAX_INTERVAL_MS - CROWD_MIN_INTERVAL_MS\)\)/)
})

test('GPS updates cannot restart the loop or fire extra buzzes', () => {
  const src = read('apps/rider/components/ApproachAlert.tsx')
  assert.match(src, /if \(now - lastSpike\.current < current\.intervalMs\) return/)
  assert.match(src, /\}, \[active, inCrowd, paused\]\)/)
  assert.doesNotMatch(src, /cue\?\.intervalMs/)
  assert.doesNotMatch(src, /setValue\(/)
})

test('arrival fires one stronger cue instead of the plain stage buzz', () => {
  const src = read('apps/rider/components/ApproachAlert.tsx')
  assert.match(src, /if \(stage === 'here'\) \{[\s\S]{0,140}lastSpike\.current = Date\.now\(\)\s*void arrivalCue\(\)/)
  const fb = read('apps/rider/lib/feedback.ts')
  assert.match(fb, /export async function arrivalCue\(\) \{\s*if \(await hapticsEnabled\(\)\)/)
})

test('every rider haptic honors the haptics setting, and Account exposes it', () => {
  const fb = read('apps/rider/lib/feedback.ts')
  for (const fn of ['tapHaptic', 'successHaptic', 'warningHaptic', 'approachHaptic']) {
    assert.match(fb, new RegExp(`export async function ${fn}\\([^)]*\\) \\{\\s*if \\(!\\(await hapticsEnabled\\(\\)\\)\\) return`), fn)
  }
  assert.match(fb, /const HAPTICS_KEY = 'rider\.haptics\.enabled'/)
  const account = read('apps/rider/app/(tabs)/account.tsx')
  assert.match(account, /label=\{hapticsOn \? 'Haptics · On' : 'Haptics · Off'\}/)
  assert.match(account, /await setHapticsEnabled\(next\)/)
})
