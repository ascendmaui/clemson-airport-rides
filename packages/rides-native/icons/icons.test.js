import assert from 'node:assert/strict'
import test from 'node:test'
import { GLYPHS, ICON_NAMES } from './glyphs.js'
import { ION_ALIASES } from './tokens.js'

test('every glyph has stroke paths on the 24px grid', () => {
  assert.ok(ICON_NAMES.length >= 90)
  for (const name of ICON_NAMES) {
    const g = GLYPHS[name]
    assert.ok(Array.isArray(g.s) && g.s.length > 0, name)
    for (const d of [...g.s, ...(g.f || []), ...(g.k || [])]) {
      assert.match(d, /^M/, name)
      for (const n of d.match(/-?\d*\.?\d+/g) || []) assert.ok(Math.abs(Number(n)) <= 24, `${name}: ${n}`)
    }
    if (g.k) assert.ok(g.f, `${name}: knockout needs a fill`)
  }
})

test('every legacy Ionicons alias resolves to a custom glyph', () => {
  for (const [ion, name] of Object.entries(ION_ALIASES)) assert.ok(GLYPHS[name], `${ion} -> ${name}`)
})

test('ride types, trip steps and tabs have glyphs', () => {
  for (const n of ['standard', 'waitSave', 'comfort', 'carpool', 'searching', 'matched', 'enRoute', 'arrived', 'inTrip', 'complete', 'home', 'rides', 'money', 'account', 'pickup', 'dropoff', 'sos', 'share', 'chat', 'call', 'pass', 'applePay', 'offline']) assert.ok(GLYPHS[n], n)
})

test('v2 language: optical sizing, accents, Clemson tokens', async () => {
  const { opticalStroke, glyphLayers } = await import('./layers.js')
  const { ICON_TOKENS } = await import('./tokens.js')
  assert.ok(opticalStroke(16) > opticalStroke(24) && opticalStroke(24) > opticalStroke(40))
  assert.equal(ICON_TOKENS.light.orange, '#F56600')
  assert.equal(ICON_TOKENS.light.purple, '#522D80')
  const accented = ICON_NAMES.filter((n) => GLYPHS[n].a)
  assert.ok(accented.length >= 20, 'route-dot motif across the family')
  for (const n of accented) for (const d of GLYPHS[n].a) assert.match(d, /^M/, n)
  const active = glyphLayers('home', { active: true }).map((l) => l.kind)
  assert.ok(active.includes('fill') && active.includes('specular') && active.includes('accent'))
  assert.ok(glyphLayers('home').some((l) => l.kind === 'wash'))
})
