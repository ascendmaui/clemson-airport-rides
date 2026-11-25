import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DRIVER = path.join(ROOT, 'apps/driver')
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

function driverSources() {
  const out = []
  for (const dir of ['app', 'components', 'lib']) {
    const walk = (d) => {
      for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
        const full = path.join(d, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(path.relative(ROOT, full))
      }
    }
    walk(path.join(DRIVER, dir))
  }
  return out
}

const codeLines = (src) => src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
// Paint swatches for the driver's own car colour are data, not theme.
// TitleStatusField keeps its two brand constants: tests/vehicleTitle.test.js pins them to the web field.
const HEX_EXEMPT = new Set(['apps/driver/lib/palette.ts', 'apps/driver/app/vehicles.tsx', 'apps/driver/components/TitleStatusField.tsx'])
const HEX = /#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g

test('boot screen says Clemson Rides Driver', () => {
  const src = read('apps/driver/components/BootScreen.tsx')
  assert.match(src, />Clemson Rides Driver</)
  assert.doesNotMatch(src, /Clemson RIDES/)
})

test('no star or crown emoji in the driver app; the shared Glyph set is used instead', () => {
  const emoji = /[★☆♛♚⭐🌟👑]/u
  for (const file of driverSources()) {
    codeLines(read(file)).forEach((line, i) => assert.doesNotMatch(line, emoji, `${file}:${i + 1}`))
  }
  assert.match(read('apps/driver/app/(tabs)/index.tsx'), /<Glyph name="star"/)
  assert.match(read('apps/driver/components/OfferGauge.tsx'), /tier === 'crown' \? <Glyph name="sparkle"/)
})

test('brand orange and purple come from tokens, not raw hex, in driver screens', () => {
  for (const file of driverSources()) {
    if (HEX_EXEMPT.has(file)) continue
    codeLines(read(file)).forEach((line, i) => assert.doesNotMatch(line, /#F56600|#522D80/i, `${file}:${i + 1}`))
  }
})

test('purple text uses the dark-aware link token (brand purple on night cards is unreadable)', () => {
  for (const file of driverSources()) {
    codeLines(read(file)).forEach((line, i) => assert.doesNotMatch(line, /(^|[^A-Za-z])color: colors\.purple\b/, `${file}:${i + 1}`))
  }
})

test('no raw hex in driver screens: fixed colours are named tokens in lib/palette.ts', () => {
  let count = 0
  for (const file of driverSources()) {
    if (HEX_EXEMPT.has(file)) continue
    for (const line of codeLines(read(file))) count += (line.match(HEX) ?? []).length
  }
  assert.ok(count <= 0, `driver screens have ${count} raw hex colours; use lib/palette.ts tokens`)
})

test('perks strip: every chip carries a brand rail and dark-aware purple text', () => {
  const src = read('apps/driver/components/PerksStrip.tsx')
  assert.match(src, /borderLeftWidth: 3,/)
  assert.match(src, /borderLeftColor: tone === 'orange' \? colors\.orange : colors\.purple/)
  assert.match(src, /case 'purple':[\s\S]*?return colors\.link/)
  assert.match(src, /· Rating \$\{/)
})

test('map heat card colours are named tokens that follow the map style', () => {
  const palette = read('apps/driver/lib/palette.ts')
  const block = palette.slice(palette.indexOf('export const mapHeatColors'))
  for (const mode of ['light', 'dark']) {
    const row = block.match(new RegExp(`${mode}: \\{([^}]*)\\}`))?.[1] ?? ''
    for (const key of ['surface', 'title', 'estimate', 'body', 'legend', 'border']) assert.match(row, new RegExp(`${key}: '`), `${mode}.${key}`)
  }
  assert.match(read('apps/driver/components/CampusMap.native.tsx'), /const heat = darkMap \? mapHeatColors\.dark : mapHeatColors\.light/)
})
