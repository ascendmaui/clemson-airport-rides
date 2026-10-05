/** Landing-page features. Copy matches the shipped rider and driver product. */

import { OFFERED_RIDE_TIERS, RIDE_OPTION_CATALOG } from './rideOptions.js'

/** Rider-facing bookable classes advertised in marketing. Exactly these three. */
export const MARKETING_BOOKABLE_TIER_IDS = ['standard', 'wait', 'comfort']

export const MARKETING_BOOKABLE_TIERS = MARKETING_BOOKABLE_TIER_IDS.map((id) => {
  const row = RIDE_OPTION_CATALOG.find((tier) => tier.id === id)
  return { id, name: row?.name || id }
})

export const MARKETING_FEATURES = [
  {
    id: 'airport',
    title: 'Airport rides',
    body: 'Schedule a ride to Greenville-Spartanburg (GSP) or Charlotte Douglas (CLT). Schedule shows the current fare, and a 25% deposit holds the trip.',
  },
  {
    id: 'student',
    title: 'Student discount',
    body: '10% off Standard when the signed-in email is confirmed and ends with @clemson.edu or @g.clemson.edu. Other ride types are not included.',
  },
  {
    id: 'gameday',
    title: 'Game day',
    body: 'When a game day is live, the rider home shows the pickup zone and the fare multiplier from the server.',
  },
  {
    id: 'weekend',
    title: 'Weekend and party',
    body: 'From Schedule, pick airport or campus and a time at least 30 minutes ahead. The trip is saved for drivers in the Weekend filter.',
  },
  {
    id: 'preferred',
    title: 'Preferred drivers',
    body: 'Save drivers you want to ride with. Pick driver lists them first, and the request stays with that driver. If they decline, the trip is canceled instead of matching someone else.',
  },
  {
    id: 'schedule',
    title: 'Schedule',
    body: 'Plan a pickup ahead of time, or hold an airport ride with a 25% deposit, from the Schedule tab.',
  },
]

const BLOCKED_BOOKABLE_PARTS = [
  ['te', 'sla'],
  ['model', ' 3'],
  ['self', '-driving'],
  ['self', ' driving'],
  ['robo', 'taxi'],
  ['auto', 'nomous'],
]

export function blockedBookableNeedles() {
  return BLOCKED_BOOKABLE_PARTS.map((parts) => parts.join(''))
}

export function copyHitsBlockedBookableClaims(text) {
  const blob = String(text || '').toLowerCase()
  return blockedBookableNeedles().filter((needle) => blob.includes(needle))
}

export function marketingFeaturesCopy() {
  return MARKETING_FEATURES.map((feature) => `${feature.title}\n${feature.body}`).join('\n')
}

function runningAsThisTestFile() {
  if (typeof process === 'undefined' || !process.env || !process.env.NODE_TEST_CONTEXT) return false
  if (typeof process.getBuiltinModule !== 'function') return false
  const entry = String(process.argv?.[1] || '')
  return entry.endsWith('marketingFeatures.js')
}

if (runningAsThisTestFile()) {
  const test = process.getBuiltinModule('node:test')
  const assert = process.getBuiltinModule('node:assert/strict')
  const { readFileSync } = process.getBuiltinModule('node:fs')

  test('marketing bookable tiers are Standard, Wait & Save, Extra Comfort only', () => {
    assert.deepEqual(MARKETING_BOOKABLE_TIER_IDS, ['standard', 'wait', 'comfort'])
    assert.deepEqual([...OFFERED_RIDE_TIERS], ['standard', 'wait', 'comfort'])
    assert.deepEqual(MARKETING_BOOKABLE_TIER_IDS, [...OFFERED_RIDE_TIERS])
    assert.deepEqual(
      MARKETING_BOOKABLE_TIERS.map((tier) => tier.id),
      ['standard', 'wait', 'comfort'],
    )
    assert.deepEqual(
      MARKETING_BOOKABLE_TIERS.map((tier) => tier.name),
      ['Standard', 'Wait & Save', 'Extra Comfort'],
    )
    assert.deepEqual(
      RIDE_OPTION_CATALOG.map((tier) => tier.id),
      MARKETING_BOOKABLE_TIER_IDS,
    )
    assert.deepEqual(
      RIDE_OPTION_CATALOG.map((tier) => tier.name),
      ['Standard', 'Wait & Save', 'Extra Comfort'],
    )
    assert.equal(MARKETING_BOOKABLE_TIERS.length, 3)
  })

  test('marketing feature copy does not claim retired fleet as bookable', () => {
    assert.deepEqual(copyHitsBlockedBookableClaims(marketingFeaturesCopy()), [])
    for (const feature of MARKETING_FEATURES) {
      assert.deepEqual(copyHitsBlockedBookableClaims(`${feature.title} ${feature.body}`), [])
    }
  })

  test('landing and product copy do not claim retired fleet as bookable', () => {
    const files = [
      new URL('../src/screens/Marketing.jsx', import.meta.url),
      new URL('../index.html', import.meta.url),
      new URL('../server/productKnowledge.js', import.meta.url),
      new URL('./productLinks.js', import.meta.url),
    ]
    const hits = []
    for (const file of files) {
      const text = readFileSync(file, 'utf8')
      for (const needle of copyHitsBlockedBookableClaims(text)) {
        const label = String(file.pathname).split('/').slice(-2).join('/')
        hits.push(`${label}:${needle}`)
      }
    }
    assert.deepEqual(hits, [])
  })

  test('product brief names the three bookable tiers', () => {
    const text = readFileSync(new URL('../server/productKnowledge.js', import.meta.url), 'utf8')
    assert.match(text, /Standard, Wait & Save, or Extra Comfort/)
    assert.doesNotMatch(text, /Choose a tier:.*XL/i)
  })
}
