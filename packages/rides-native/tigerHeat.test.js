import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyDurationBonus,
  bestPayableZone,
  bonusCentsFromRequestCount,
  circlePolygon,
  evaluateTigerHeat,
  formatTigerHeatLabel,
  heatLevelForCents,
  zoneContains,
} from './tigerHeat.js'

function at(year, month, day, hour) {
  return new Date(year, month - 1, day, hour, 0, 0, 0)
}

const COLLEGE = { lat: 34.6839, lng: -82.8366 }

test('flat dollar bonuses scale from $10 to $30 by request count', () => {
  assert.equal(bonusCentsFromRequestCount(3), 0)
  assert.equal(bonusCentsFromRequestCount(4), 1000)
  assert.equal(bonusCentsFromRequestCount(6), 1500)
  assert.equal(bonusCentsFromRequestCount(8), 2000)
  assert.equal(bonusCentsFromRequestCount(12), 3000)
  assert.equal(bonusCentsFromRequestCount(40), 3000)
  assert.equal(formatTigerHeatLabel(1200), 'Tiger Heat · +$12')
  assert.equal(formatTigerHeatLabel(1200, { preview: true }), 'Preview · Tiger Heat · +$12')
  assert.equal(formatTigerHeatLabel(2000).includes('x'), false)
  assert.equal(heatLevelForCents(1000), 'peak')
  assert.equal(heatLevelForCents(2000), 'great')
  assert.equal(heatLevelForCents(3000), 'rare')
  assert.equal(heatLevelForCents(400), 'reduced')
})

test('duration adds flat dollars and stays inside the $30 cap', () => {
  const short = applyDurationBonus(1000, 15, false)
  assert.equal(short.bonusCents, 1000)
  assert.equal(short.durationAdjustmentCents, 0)

  const game = applyDurationBonus(1000, 40, true)
  assert.equal(game.durationAdjustmentCents, 1300)
  assert.equal(game.bonusCents, 2300)
  assert.equal(game.capped, false)

  const capped = applyDurationBonus(2000, 120, true)
  assert.equal(capped.bonusCents, 3000)
  assert.equal(capped.capped, true)
})

test('live density pays and clock heat stays a preview', () => {
  const requests = Array.from({ length: 8 }, () => ({ ...COLLEGE }))
  const live = evaluateTigerHeat({ at: at(2026, 10, 5, 12), requests, activation: 'live' })
  const hot = live.payableZones.find((zone) => zone.id === 'college-ave-core')
  assert.ok(hot)
  assert.equal(hot.payable, true)
  assert.equal(hot.preview, false)
  assert.equal(hot.bonusCents, 2000)
  assert.equal(hot.bonusLabel, 'Tiger Heat · +$20')
  assert.equal(hot.polygon.length, 24)
  assert.equal(zoneContains(hot, COLLEGE.lat, COLLEGE.lng), true)
  assert.equal(hot.fillColor, '#F56600')
  assert.equal(hot.strokeColor, '#522D80')

  const quiet = evaluateTigerHeat({ at: at(2026, 10, 5, 12), requests: [], activation: 'live' })
  assert.equal(quiet.payableZones.length, 0)

  const friday = evaluateTigerHeat({ at: at(2026, 9, 25, 22), requests: [], activation: 'preview-clock' })
  const ave = friday.zones.find((zone) => zone.id === 'college-ave-core')
  const stadium = friday.zones.find((zone) => zone.id === 'memorial-stadium')
  assert.equal(ave.preview, true)
  assert.equal(ave.payable, false)
  assert.match(ave.bonusLabel, /^Preview · Tiger Heat · \+\$/)
  assert.equal(stadium, undefined)

  const saturday = evaluateTigerHeat({ at: at(2026, 9, 26, 15), requests: [], activation: 'preview-clock' })
  const deathValley = saturday.zones.find((zone) => zone.id === 'memorial-stadium')
  assert.equal(deathValley.payable, false)
  assert.match(deathValley.bonusLabel, /^Preview · Tiger Heat · \+\$/)
  assert.equal(saturday.zones.some((zone) => zone.id === 'college-ave-core'), false)
})

test('the hottest payable zone containing the pickup wins once', () => {
  const requests = Array.from({ length: 12 }, () => ({ ...COLLEGE }))
  const live = evaluateTigerHeat({ at: at(2026, 10, 5, 23), requests, activation: 'live' })
  const winner = bestPayableZone(COLLEGE.lat, COLLEGE.lng, live.zones)
  assert.equal(winner.payable, true)
  assert.equal(winner.bonusCents, 3000)
  const far = bestPayableZone(34.5, -82.5, live.zones)
  assert.equal(far, null)
})

test('a polygon point sits on the zone radius', () => {
  const ring = circlePolygon(COLLEGE.lat, COLLEGE.lng, 200, 8)
  assert.equal(ring.length, 8)
  for (const point of ring) {
    assert.ok(Math.abs(point.lat) > 0)
    assert.ok(Math.abs(point.lng) > 0)
  }
})
