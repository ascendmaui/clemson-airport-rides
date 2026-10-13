import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { DRIVER_CARPOOL_BONUS_ID, incentiveLabel } from '../packages/rides-native/tripTags.js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const read = (file) => readFileSync(path.join(root, file), 'utf8')

test('rider and driver iOS apps are iPhone-only', () => {
  for (const app of ['rider', 'driver']) {
    const config = JSON.parse(read(`apps/${app}/app.json`))
    assert.equal(config.expo.ios.supportsTablet, false, `${app} must not support iPad`)
  }
})

test('incentive ids get a human label', () => {
  assert.equal(incentiveLabel(DRIVER_CARPOOL_BONUS_ID), 'Carpool bonus')
  assert.equal(incentiveLabel('driver_game_day_boost'), 'Game day boost')
  assert.equal(incentiveLabel(''), '')
})

test('driver UI never shows the raw driver_carpool_bonus key', () => {
  for (const file of [
    'apps/driver/app/(tabs)/earnings.tsx',
    'apps/driver/app/earnings-activity.tsx',
    'apps/driver/app/trip-details.tsx',
    'apps/driver/components/FarePanel.tsx',
    'src/screens/DriverHome.jsx',
  ]) {
    assert.doesNotMatch(read(file), /driver_carpool_bonus/, file)
  }
  assert.match(read('apps/driver/app/earnings-activity.tsx'), /incentiveLabel\(pay\.incentiveId\)/)
  assert.match(read('apps/driver/app/trip-details.tsx'), /incentiveLabel\(trip\.carpoolIncentiveId\)/)
  assert.match(read('apps/driver/components/FarePanel.tsx'), /incentiveLabel\(fare\.carpoolIncentiveId\)/)
})

test('driver queue renders its filter chips once', () => {
  const queue = read('apps/driver/app/queue.tsx')
  assert.equal(queue.match(/queueFilters\(\)\.map/g)?.length, 1)
})

test('driver promo copy does not name competitors', () => {
  for (const file of ['apps/driver/app/onboarding.tsx', 'packages/rides-native/driverGateView.js']) {
    assert.doesNotMatch(read(file), /\b(uber|lyft)\b/i, file)
  }
})
