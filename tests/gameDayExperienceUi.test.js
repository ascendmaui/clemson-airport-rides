import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function read(rel) {
  return readFileSync(path.join(root, rel), 'utf8')
}

const COLOR_FILES = [
  'shared/gameDayExperience.js',
  'packages/rides-native/GameDayBoard.jsx',
  'src/components/GameDayBoard.jsx',
  'apps/rider/app/game-day.tsx',
]
const COPY_FILES = [
  ...COLOR_FILES,
  'packages/rides-native/useGameDayExperience.js',
  'apps/driver/app/game-day.tsx',
  'supabase/migrations/20261013100000_game_day_experience.sql',
]

test('game-day surfaces use the orange and purple palette and avoid retired marks', () => {
  const banned = new RegExp(['te' + 'sla', 'death valley', 'tigers', 'memorial stadium', 'iptay'].join('|'), 'i')
  for (const rel of COLOR_FILES) {
    const text = read(rel)
    assert.match(text, /#F56600|colors\.orange\b/, rel)
    assert.match(text, /#522D80|colors\.purple\b/, rel)
  }
  for (const rel of COPY_FILES) {
    assert.doesNotMatch(read(rel), banned, rel)
  }
})

test('rider, driver, and web home screens mount the game-day experience', () => {
  const rider = read('apps/rider/app/(tabs)/index.tsx')
  const driver = read('apps/driver/app/(tabs)/index.tsx')
  const discover = read('apps/driver/app/discover.tsx')
  const webRider = read('src/screens/RiderHome.jsx')
  const webDriver = read('src/screens/DriverHome.jsx')
  const tiers = read('src/screens/RideTiers.jsx')
  assert.match(rider, /GameDayBanner/)
  assert.match(rider, /\/game-day/)
  assert.match(read('apps/rider/app/game-day.tsx'), /audience="rider"/)
  const surgeAt = driver.indexOf('<GameDaySurgeLine')
  const goAt = driver.indexOf('<GoButton')
  assert.ok(surgeAt > 0 && surgeAt < goAt, 'surge multiplier renders before Go online')
  assert.match(driver, /!online/)
  assert.match(discover, /\/game-day/)
  assert.match(read('apps/driver/app/game-day.tsx'), /audience="driver"/)
  assert.match(webRider, /GameDayBoard/)
  assert.match(webRider, /audience="rider"/)
  const boardAt = webDriver.indexOf('<GameDayBoard')
  const shiftAt = webDriver.indexOf('<DriverShiftControl')
  assert.ok(boardAt > 0 && boardAt < shiftAt, 'driver web board sits before the shift control')
  assert.match(tiers, /GameDaySurgeNote/)
})
