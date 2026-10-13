import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

test('driver offers explain the worth-it gauge with theme colors', () => {
  const legend = read('packages/rides-native/WorthItLegend.jsx')
  const sheet = read('packages/rides-native/InfoSheet.jsx')
  const home = read('apps/driver/app/(tabs)/index.tsx')
  const queue = read('apps/driver/app/queue.tsx')
  const bridge = read('apps/driver/components/OfferBridge.tsx')
  assert.match(legend, /WORTH_IT_LEGEND_TITLE/)
  assert.match(legend, /WORTH_IT_GAUGE_BODY/)
  assert.match(legend, /worthItTierForHourlyCents/)
  assert.match(legend, /tone\.ink/)
  assert.match(legend, /tone\.orange \|\| ORANGE/)
  assert.match(sheet, /tone\.card/)
  assert.match(sheet, /tone\.scrim/)
  assert.match(sheet, /tone\.orange \|\| ORANGE/)
  assert.match(sheet, /tone\.title \|\| tone\.purple \|\| PURPLE/)
  assert.match(sheet, /#F56600/)
  assert.match(sheet, /#522D80/)
  for (const source of [home, queue, bridge]) {
    assert.match(source, /<WorthItLegend/)
    assert.match(source, /colors=\{colors\}/)
  }
  assert.match(home, /hourlyCents=\{hourlyQuote\.hourlyCents\}/)
  assert.match(queue, /hourlyCents=\{hourlyQuote\.hourlyCents\}/)
  assert.match(bridge, /hourlyCents=\{banner\.hourlyCents\}/)
})

test('rider ride pickers open the ride type sheet', () => {
  const sheet = read('packages/rides-native/RideTypeSheet.jsx')
  const tiers = read('apps/rider/app/tiers.tsx')
  const schedule = read('apps/rider/app/(tabs)/schedule.tsx')
  const near = read('apps/rider/components/NearTermSlots.tsx')
  const marketing = read('src/screens/MarketingInfo.jsx')
  assert.match(sheet, /RIDE_TYPE_GUIDE/)
  assert.match(sheet, /tone\.ink/)
  assert.match(sheet, /tone\.purple \|\| RIDE_TYPE_PURPLE/)
  assert.match(sheet, /tone\.orange \|\| ORANGE/)
  assert.match(sheet, /#F56600/)
  for (const source of [tiers, schedule, near]) {
    assert.match(source, /<RideTypeInfoButton/)
    assert.match(source, /colors=\{colors\}/)
  }
  assert.match(tiers, /selectedId=\{selected\}/)
  assert.match(schedule, /selectedId=\{fleet\}/)
  assert.match(near, /selectedId=\{tier\}/)
  assert.match(marketing, /RIDE_TYPE_NOTES\[tier\.id\]/)
  assert.match(marketing, /RIDE_TYPE_STUDENT_NOTE/)
})

test('tier legend sources stay clear of retired fleet words', () => {
  const banned = new RegExp(['te' + 'sla', 'robo' + 'taxi', 'self' + '-driving'].join('|'), 'i')
  const files = [
    'shared/worthItGauge.js',
    'shared/copy/rideTypes.js',
    'packages/rides-native/WorthItLegend.jsx',
    'packages/rides-native/RideTypeSheet.jsx',
    'packages/rides-native/InfoSheet.jsx',
  ]
  for (const file of files) {
    assert.doesNotMatch(read(file), banned, file)
  }
})
