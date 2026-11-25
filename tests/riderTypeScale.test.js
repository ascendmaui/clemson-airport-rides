import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { OFFERED_RIDE_TIERS } from '../shared/rideOptions.js'
import { DENSE_FONT_SCALE } from '../apps/rider/lib/denseType.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

test('dense type scale caps chips at about 1.4', () => {
  assert.ok(DENSE_FONT_SCALE >= 1.3 && DENSE_FONT_SCALE <= 1.5)
  assert.match(read('apps/rider/components/DenseText.tsx'), /maxFontSizeMultiplier=\{DENSE_FONT_SCALE\}/)
  assert.match(read('apps/rider/lib/denseType.ts'), /DENSE_FONT_SCALE = 1\.4/)
  assert.match(read('apps/rider/components/Button.tsx'), /<DenseText/)
  const tabs = read('packages/rides-native/icons/GlassTabBar.jsx')
  assert.match(tabs, /maxFontSizeMultiplier=\{rider \? 1\.4 : undefined\}/)
  assert.match(tabs, /labelReadable: \{ fontSize: 12 \}/)
  assert.match(tabs, /label: \{ fontSize: 11/)
})

test('rider screens do not set text under 12pt', () => {
  const small = /fontSize:\s*(?:9|10|11)\b/
  const hits = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') walk(full)
      } else if (/\.(tsx?|jsx?)$/.test(entry.name) && small.test(fs.readFileSync(full, 'utf8'))) {
        hits.push(path.relative(ROOT, full))
      }
    }
  }
  walk(path.join(ROOT, 'apps/rider'))
  assert.deepEqual(hits, [])
})

test('booking sheet draws each ride type with the shared glyph', () => {
  const tiers = read('apps/rider/app/tiers.tsx')
  assert.match(tiers, /<Glyph\s+name=\{rideTypeIconName\(tier\.id\)\}/)
  assert.match(tiers, /borderColor: on \? colors\.orange : colors\.purple/)
  for (const id of OFFERED_RIDE_TIERS) {
    assert.equal(['standard', 'wait', 'comfort', 'carpool'].includes(id), true)
  }
  assert.equal(OFFERED_RIDE_TIERS.length, 4)
})
