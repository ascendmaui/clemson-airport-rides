import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const bridge = readFileSync(new URL('../apps/driver/components/OfferBridge.tsx', import.meta.url), 'utf8')

test('tapping the in-app offer banner stops the repeating request pulse', () => {
  assert.match(bridge, /onPress=\{\(\) => \{[\s\S]{0,200}stopRequestPulse\(\)\s*setBanner\(null\)/)
})

test('the request pulse still auto-stops after the exclusive window', () => {
  assert.match(bridge, /setTimeout\(\(\) => stopRequestPulse\(\), EXCLUSIVE_SECONDS \* 1000\)/)
})
