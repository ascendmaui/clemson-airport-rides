import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { OFFERED_RIDE_TIERS, RIDE_OPTION_CATALOG } from '../../shared/rideOptions.js'
import { bookableRideTiers } from './places.js'
import { RIDE_TYPE_ICONS, rideTypeIconName } from './rideTypeIcons.js'
import { GLYPHS } from './icons/glyphs.js'

test('every offered ride type maps to a stable custom glyph name', () => {
  assert.deepEqual(Object.keys(RIDE_TYPE_ICONS), OFFERED_RIDE_TIERS)
  assert.deepEqual(bookableRideTiers().map((tier) => tier.id), OFFERED_RIDE_TIERS)
  for (const id of OFFERED_RIDE_TIERS) {
    const name = rideTypeIconName(id)
    assert.equal(name, RIDE_TYPE_ICONS[id])
    assert.ok(Object.hasOwn(GLYPHS, name), `${id}: missing glyph ${name}`)
  }
})

test('rider picker renders the shared Glyph component instead of raw emoji or glyph text', () => {
  const picker = readFileSync(new URL('../../apps/rider/app/tiers.tsx', import.meta.url), 'utf8')
  assert.match(picker, /import\s*\{[^}]*\bGlyph\b[^}]*\}\s*from\s*['"]rides-native\/icons['"]/)
  assert.match(picker, /import\s*\{\s*rideTypeIconName\s*\}\s*from\s*['"]rides-native\/rideTypeIcons\.js['"]/)
  assert.match(picker, /<Glyph\s+name=\{rideTypeIconName\(tier\.id\)\}/)
  assert.doesNotMatch(picker, /@expo\/vector-icons/)
  assert.doesNotMatch(picker, /tier\s*(?:\.\s*icon\b|\[\s*['"]icon['"]\s*\])/)
  for (const tier of [...bookableRideTiers(), ...RIDE_OPTION_CATALOG]) {
    assert.ok(!picker.includes(tier.icon), `${tier.id}: picker contains raw emoji`)
  }
})
