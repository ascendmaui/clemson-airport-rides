import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { OFFERED_RIDE_TIERS, RIDE_OPTION_CATALOG } from '../../shared/rideOptions.js'
import { bookableRideTiers } from './places.js'
import { RIDE_TYPE_ICONS, rideTypeIconName } from './rideTypeIcons.js'

// Resolve the rider's installed version, not a different app's icon package.
// Install with npm ci --prefix apps/rider before running the root suite.
const riderRequire = createRequire(new URL('../../apps/rider/package.json', import.meta.url))
const glyphMap = riderRequire('@expo/vector-icons/build/vendor/react-native-vector-icons/glyphmaps/Ionicons.json')

test('every offered ride type maps to a glyph in the rider bundled Ionicons font', () => {
  assert.deepEqual(Object.keys(RIDE_TYPE_ICONS), OFFERED_RIDE_TIERS)
  assert.deepEqual(bookableRideTiers().map((tier) => tier.id), OFFERED_RIDE_TIERS)
  for (const id of OFFERED_RIDE_TIERS) {
    const name = rideTypeIconName(id)
    assert.equal(name, RIDE_TYPE_ICONS[id])
    assert.ok(Object.hasOwn(glyphMap, name), `${id}: missing Ionicons glyph ${name}`)
    assert.equal(typeof glyphMap[name], 'number')
  }
})

test('rider picker renders the mapped Ionicons component instead of raw emoji or glyph text', () => {
  const picker = readFileSync(new URL('../../apps/rider/app/tiers.tsx', import.meta.url), 'utf8')
  assert.match(picker, /import\s*\{\s*Ionicons\s*\}\s*from\s*['"]@expo\/vector-icons['"]/)
  assert.match(picker, /import\s*\{\s*rideTypeIconName\s*\}\s*from\s*['"]rides-native\/rideTypeIcons\.js['"]/)
  assert.match(picker, /<Ionicons\s+name=\{rideTypeIconName\(tier\.id\)\}/)
  assert.doesNotMatch(picker, /tier\s*(?:\.\s*icon\b|\[\s*['"]icon['"]\s*\])/)
  for (const tier of [...bookableRideTiers(), ...RIDE_OPTION_CATALOG]) {
    assert.ok(!picker.includes(tier.icon), `${tier.id}: picker contains raw emoji`)
  }
})
