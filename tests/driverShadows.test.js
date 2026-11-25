import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { glow, glowStyle, shadowStyle } from '../packages/rides-native/shared/theme.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8')

function sources(dir) {
  const out = []
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = path.join(dir, name)
    if (statSync(full).isDirectory()) out.push(...sources(full))
    else if (/\.tsx?$/.test(name) && !/\.test\./.test(name)) out.push(full)
  }
  return out
}

test('glowStyle: tinted shadow on iOS, plus an orange ring on Android', () => {
  const ios = glowStyle('#F56600', 'ios')
  assert.equal(ios.shadowColor, '#F56600')
  assert.equal(ios.shadowOpacity, glow.shadowOpacity)
  assert.equal(ios.elevation, glow.elevation)
  assert.equal(ios.borderWidth, undefined)
  const android = glowStyle('#F56600', 'android')
  assert.equal(android.shadowColor, '#F56600')
  assert.equal(android.borderWidth, 3)
  assert.equal(android.borderColor, 'rgba(245,102,0,0.55)')
  assert.deepEqual(glowStyle('#F56600').shadowOffset, { width: 0, height: 8 })
})

test('driver app has no hand-written shadows: shadowStyle or the glow token only', () => {
  const offenders = []
  for (const file of sources(path.join(ROOT, 'apps/driver'))) {
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      if (/\bshadow(Color|Opacity|Radius|Offset)\s*:/.test(line)) offenders.push(`${path.relative(ROOT, file)}:${i + 1}`)
    })
  }
  // The gauge halo keeps its own zero-offset radius over the glow token.
  assert.deepEqual(offenders.filter((o) => !o.startsWith('apps/driver/components/OfferGauge.tsx')), [])
  const gauge = read('apps/driver/components/OfferGauge.tsx')
  assert.match(gauge, /glowStyleFor\(swatch\.accent, Platform\.OS\)/)
  assert.match(gauge, /shadowStyle\(swatch\.accent, 'float', scheme\)/)
})

test('GO keeps the orange glow, with the Android fallback', () => {
  const shell = read('apps/driver/components/shell.tsx')
  assert.match(shell, /\.\.\.glowStyle\(color\.orange, Platform\.OS\)/)
  assert.equal(shadowStyle('#522D80', 'float').elevation, 6)
})
