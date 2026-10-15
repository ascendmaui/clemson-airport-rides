import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { darkPalette, heatLabelFor, lightPalette } from '../apps/rider/lib/palette.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HEX = /#[0-9A-Fa-f]{6}\b|#[0-9A-Fa-f]{3}\b/g
const HEX_EXEMPT = new Set(['apps/rider/lib/palette.ts'])

function riderSources() {
  const out = []
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (/\.(tsx?|jsx?)$/.test(entry.name)) out.push(path.relative(ROOT, full))
    }
  }
  walk(path.join(ROOT, 'apps/rider'))
  return out
}

function codeLines(src) {
  return src.split('\n').filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
}

function channel(hex, index) {
  const raw = hex.replace('#', '')
  const value = parseInt(raw.slice(index, index + 2), 16) / 255
  return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function contrast(fg, bg) {
  const lum = (hex) => 0.2126 * channel(hex, 0) + 0.7152 * channel(hex, 2) + 0.0722 * channel(hex, 4)
  const lighter = Math.max(lum(fg), lum(bg))
  const darker = Math.min(lum(fg), lum(bg))
  return (lighter + 0.05) / (darker + 0.05)
}

test('small orange ink clears AA; brand orange on white does not', () => {
  assert.ok(contrast(lightPalette.orange, '#FFFFFF') < 4.5)
  assert.ok(contrast(lightPalette.orangeInk, '#FFFFFF') >= 4.5)
  assert.ok(contrast(darkPalette.orangeInk, darkPalette.background) >= 4.5)
  assert.equal(lightPalette.orange, '#F56600')
  assert.equal(darkPalette.orange, '#F56600')
})

test('dark heat labels do not use a white glow', () => {
  assert.match(heatLabelFor('dark').shadow, /rgba\(0,0,0/)
  assert.doesNotMatch(heatLabelFor('dark').shadow, /255,\s*255,\s*255/)
  assert.match(heatLabelFor('dark').chip, /22,18,31/)
})

test('rider screens keep hex in the palette only', () => {
  let count = 0
  for (const file of riderSources()) {
    if (HEX_EXEMPT.has(file)) continue
    for (const line of codeLines(fs.readFileSync(path.join(ROOT, file), 'utf8'))) {
      count += (line.match(HEX) ?? []).length
    }
  }
  assert.equal(count, 0)
})
